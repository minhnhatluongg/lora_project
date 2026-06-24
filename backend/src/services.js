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
  };
}

export function setMode(mode) {
  db.prepare(`UPDATE system_status SET mode = ? WHERE id = 1`).run(mode);
  emit(EVENTS.STATUS, getStatus());
}

export function touchMaster({ loraRssi, slaveOnline } = {}) {
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

// ---- Config (thresholds + automation rules) --------------------------------
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

// Inspect a telemetry reading against the CONFIGURED thresholds and raise alerts.
export function checkThresholds({ ph, ec, temperature, humidity }) {
  const t = getConfig().thresholds;
  if (ph != null && ph < t.phMin)
    createAlert('warning', `pH thấp hơn ngưỡng (${t.phMin})`);
  if (ph != null && ph > t.phMax)
    createAlert('warning', `pH cao hơn ngưỡng (${t.phMax})`);
  if (ec != null && ec > t.ecMax)
    createAlert('warning', `EC cao hơn ngưỡng (${t.ecMax} mS/cm)`);
  if (temperature != null && temperature > t.tempMax)
    createAlert('danger', `Nhiệt độ cao hơn ngưỡng (${t.tempMax}°C)`);
  if (humidity != null && humidity < t.humidityMin)
    createAlert('warning', `Độ ẩm thấp hơn ngưỡng (${t.humidityMin}%)`);
}

// ---- AUTO-mode automation engine -------------------------------------------
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
