import { db } from './db.js';
import { config } from './config.js';
import { emit, EVENTS } from './realtime.js';

// ---- Devices ---------------------------------------------------------------
export function getDevices() {
  return db
    .prepare(`SELECT id, name, state, updated_at FROM devices ORDER BY id`)
    .all()
    .map((d) => ({ ...d, state: d.state ? 'ON' : 'OFF' }));
}

export function setDeviceState(id, on) {
  const info = db
    .prepare(
      `UPDATE devices SET state = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .run(on ? 1 : 0, id);
  if (info.changes > 0) emit(EVENTS.DEVICES, getDevices());
  return info.changes > 0;
}

// ---- System status ---------------------------------------------------------
export function getStatus() {
  const row = db.prepare(`SELECT * FROM system_status WHERE id = 1`).get();
  const now = Date.now();
  const masterSeen = row.master_seen_at
    ? new Date(row.master_seen_at + 'Z').getTime()
    : 0;
  const masterOnline =
    masterSeen > 0 &&
    now - masterSeen < config.masterTimeoutSeconds * 1000;
  return {
    mode: row.mode,
    masterOnline,
    slaveOnline: !!row.slave_online,
    loraRssi: row.lora_rssi,
    masterSeenAt: row.master_seen_at,
    slaveSeenAt: row.slave_seen_at,
    // Result of the last Modbus RS485 transaction reported by the STM32 node.
    sensorStatus: row.sensor_status || null,
    sensorErrorAt: row.sensor_error_at,
  };
}

export function setMode(mode) {
  db.prepare(`UPDATE system_status SET mode = ? WHERE id = 1`).run(mode);
  emit(EVENTS.STATUS, getStatus());
}

export function touchMaster({ loraRssi, slaveOnline, sensorStatus } = {}) {
  const fields = [`master_seen_at = datetime('now')`];
  const params = [];
  if (loraRssi !== undefined && loraRssi !== null) {
    fields.push(`lora_rssi = ?`);
    params.push(loraRssi);
  }
  if (slaveOnline !== undefined) {
    fields.push(`slave_online = ?`, `slave_seen_at = datetime('now')`);
    params.push(slaveOnline ? 1 : 0);
  }
  if (sensorStatus) {
    fields.push(`sensor_status = ?`);
    params.push(sensorStatus);
    if (sensorStatus !== 'OK') fields.push(`sensor_error_at = datetime('now')`);
  }
  db.prepare(`UPDATE system_status SET ${fields.join(', ')} WHERE id = 1`).run(
    ...params
  );
}

// ---- Alerts ----------------------------------------------------------------
export function createAlert(level, message) {
  const info = db
    .prepare(`INSERT INTO alerts (level, message) VALUES (?, ?)`)
    .run(level, message);
  const alert = db
    .prepare(`SELECT * FROM alerts WHERE id = ?`)
    .get(info.lastInsertRowid);
  emit(EVENTS.ALERT, alert);
  return alert;
}

// Readings arrive every few seconds, so a value parked outside its threshold
// would otherwise produce hundreds of identical alerts. Raise one per
// condition, then stay quiet until it clears or the repeat window elapses.
const activeConditions = new Map(); // key -> timestamp of last alert

function raise(key, level, message) {
  const last = activeConditions.get(key) || 0;
  if (Date.now() - last < config.alertRepeatSeconds * 1000) return;
  activeConditions.set(key, Date.now());
  createAlert(level, message);
}

function clearCondition(key) {
  activeConditions.delete(key);
}

// ---- Config (thresholds + tank calibration + automation rules) --------------
export function getConfig() {
  const row = db.prepare(`SELECT data FROM app_config WHERE id = 1`).get();
  return JSON.parse(row.data);
}

export function setConfig(next) {
  db.prepare(`UPDATE app_config SET data = ? WHERE id = 1`).run(
    JSON.stringify(next)
  );
  return next;
}

// ---- Ultrasonic tanks ------------------------------------------------------
export const TANK_IDS = ['dist1', 'dist2', 'dist3', 'dist4'];

// Convert an air-gap distance (cm) into a fill level (%) using the tank's
// two-point calibration. Returns null when the reading or calibration is unusable.
export function tankLevelPct(distanceCm, tank) {
  if (distanceCm == null || !tank) return null;
  const { emptyCm, fullCm } = tank;
  if (emptyCm == null || fullCm == null || emptyCm === fullCm) return null;
  const pct = ((emptyCm - distanceCm) / (emptyCm - fullCm)) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)));
}

// Attach level1..level4 (%) to a telemetry row so every client sees the same
// numbers without re-implementing the calibration maths.
export function withLevels(row, cfg = getConfig()) {
  if (!row) return row;
  const levels = {};
  TANK_IDS.forEach((distKey, i) => {
    levels[`level${i + 1}`] = tankLevelPct(row[distKey], cfg.tanks?.[distKey]);
  });
  return { ...row, ...levels };
}

export const withLevelsAll = (rows) => {
  const cfg = getConfig();
  return (rows || []).map((r) => withLevels(r, cfg));
};

// ---- Threshold checks ------------------------------------------------------
// `reading` is a telemetry row already enriched with level1..level4.
export function checkThresholds(reading) {
  const cfg = getConfig();
  const t = cfg.thresholds;
  const { ph, ec, temperature, humidity, n, p, k } = reading;

  const check = (key, active, level, message) =>
    active ? raise(key, level, message) : clearCondition(key);

  check('ph-low', ph != null && ph < t.phMin, 'warning',
    `pH ${ph} thấp hơn ngưỡng (${t.phMin})`);
  check('ph-high', ph != null && ph > t.phMax, 'warning',
    `pH ${ph} cao hơn ngưỡng (${t.phMax})`);
  check('ec-high', ec != null && ec > t.ecMax, 'warning',
    `EC ${ec} µS/cm cao hơn ngưỡng (${t.ecMax} µS/cm)`);
  check('temp-high', temperature != null && temperature > t.tempMax, 'danger',
    `Nhiệt độ ${temperature}°C cao hơn ngưỡng (${t.tempMax}°C)`);
  check('humidity-low', humidity != null && humidity < t.humidityMin, 'warning',
    `Độ ẩm đất ${humidity}% thấp hơn ngưỡng (${t.humidityMin}%)`);

  check('n-low', n != null && n < t.nMin, 'warning',
    `Đạm (N) ${n} mg/kg thấp hơn ngưỡng (${t.nMin})`);
  check('p-low', p != null && p < t.pMin, 'warning',
    `Lân (P) ${p} mg/kg thấp hơn ngưỡng (${t.pMin})`);
  check('k-low', k != null && k < t.kMin, 'warning',
    `Kali (K) ${k} mg/kg thấp hơn ngưỡng (${t.kMin})`);

  TANK_IDS.forEach((distKey, i) => {
    const tank = cfg.tanks?.[distKey];
    if (!tank?.enabled) return clearCondition(`tank-${i + 1}`);
    const pct = reading[`level${i + 1}`];
    check(`tank-${i + 1}`, pct != null && pct < t.tankLowPct, 'danger',
      `${tank.name} còn ${pct}% — dưới ngưỡng (${t.tankLowPct}%)`);
    check(`tank-${i + 1}-err`, reading[distKey] == null, 'warning',
      `${tank.name}: cảm biến siêu âm không phản hồi`);
  });
}

// ---- AUTO-mode automation engine -------------------------------------------
// Metrics a rule may reference. Raw probe values plus the derived tank levels.
export const AUTOMATION_METRICS = [
  'temperature', 'humidity', 'ph', 'ec', 'n', 'p', 'k',
  'dist1', 'dist2', 'dist3', 'dist4',
  'level1', 'level2', 'level3', 'level4',
];

// On each telemetry reading, when the system is in AUTO mode, evaluate every
// enabled rule. If a device's desired state differs from its current state and
// there's no pending command yet, enqueue a command for the ESP32 to execute.
export function runAutomation(reading) {
  if (getStatus().mode !== 'AUTO') return;
  const { automation } = getConfig();

  for (const [deviceId, rule] of Object.entries(automation || {})) {
    if (!rule?.enabled) continue;
    const metricValue = reading[rule.metric];
    if (metricValue == null) continue;

    const condition =
      rule.op === 'below'
        ? metricValue < rule.value
        : metricValue > rule.value;
    const desired = condition ? 'ON' : 'OFF';

    const device = db
      .prepare(`SELECT state FROM devices WHERE id = ?`)
      .get(deviceId);
    if (!device) continue;
    const current = device.state ? 'ON' : 'OFF';
    if (current === desired) continue;

    // Skip if a command for this device is already waiting/sent
    const pending = db
      .prepare(
        `SELECT 1 FROM commands WHERE device_id = ? AND status != 'acked' LIMIT 1`
      )
      .get(deviceId);
    if (pending) continue;

    db.prepare(`INSERT INTO commands (device_id, action) VALUES (?, ?)`).run(
      deviceId,
      desired
    );
    createAlert(
      'info',
      `AUTO: ${deviceId} → ${desired} (${rule.metric} ${metricValue} ${rule.op} ${rule.value})`
    );
  }
}
