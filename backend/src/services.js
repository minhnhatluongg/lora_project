import { db } from './db.js';
import { config } from './config.js';
import { emit, EVENTS } from './realtime.js';

// ---- Devices ---------------------------------------------------------------
// The panel drives five pumps and four valves. Pumps and valves behave
// differently in AUTO (only pumps get the short-cycle guard), so keep the two
// lists separate rather than pattern-matching on the id string everywhere.
export const PUMP_IDS = ['pump1', 'pump2', 'pump3', 'pump4', 'pump5'];
export const VALVE_IDS = ['van1', 'van2', 'van3', 'van4'];

// Back-compat: firmware flashed before the one-pump -> five-pump change still
// says 'pump'. Accept it everywhere a device id comes in from outside and
// resolve it to the renamed row, so a field ESP32 keeps working un-reflashed.
const LEGACY_DEVICE_IDS = { pump: 'pump1' };
export const resolveDeviceId = (id) =>
  LEGACY_DEVICE_IDS[String(id ?? '')] || String(id ?? '');

export function getDevices() {
  return db
    .prepare(`SELECT id, name, state, updated_at FROM devices ORDER BY id`)
    .all()
    .map((d) => ({ ...d, state: d.state ? 'ON' : 'OFF' }));
}

export function setDeviceState(id, on) {
  const deviceId = resolveDeviceId(id);
  const before = db
    .prepare(`SELECT state FROM devices WHERE id = ?`)
    .get(deviceId);
  if (!before) return false;

  const next = on ? 1 : 0;
  db.prepare(
    `UPDATE devices SET state = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(next, deviceId);

  // Only a real OFF->ON / ON->OFF flip restarts the pump short-cycle guard;
  // the master re-reporting the same state every poll must not keep pushing it.
  if (before.state !== next) markPumpTransition(deviceId, next ? 'ON' : 'OFF');

  emit(EVENTS.DEVICES, getDevices());
  return true;
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
    // DỪNG KHẨN CẤP — see setEmergencyStop() for what it inhibits.
    eStop: !!row.e_stop,
    // What the field engine is doing right now. The AUTO and mixing state
    // machines run on the ESP32 with no network, so these only mean anything
    // while the master is reporting; null = we have not heard.
    autoState: row.auto_state || null,
    mixState: row.mix_state || null,
    mixReady: !!row.mix_ready,
    engineSeenAt: row.engine_seen_at || null,
  };
}

// The master telling us what it is actually doing: which mode the panel is in
// (it can be changed at the Nextion or by the cabinet switch, where the web
// never sees it) and which step each state machine has reached.
//
// Every field is optional; absent means "no news", not "cleared".
export function reportFromMaster({ mode, autoState, mixState, mixReady } = {}) {
  const sets = [];
  const params = [];
  const before = getStatus().mode;

  if (mode === 'AUTO' || mode === 'MANUAL' || mode === 'NONE') {
    sets.push(`mode = ?`);
    params.push(mode);
  }
  if (typeof autoState === 'string' && autoState) {
    sets.push(`auto_state = ?`);
    params.push(autoState);
  }
  if (typeof mixState === 'string' && mixState) {
    sets.push(`mix_state = ?`);
    params.push(mixState);
  }
  if (mixReady !== undefined) {
    sets.push(`mix_ready = ?`);
    params.push(mixReady ? 1 : 0);
  }
  if (!sets.length) return getStatus();

  sets.push(`engine_seen_at = datetime('now')`);
  db.prepare(`UPDATE system_status SET ${sets.join(', ')} WHERE id = 1`).run(...params);

  // A mode change made at the panel is worth an alert line — otherwise someone
  // reading the log later cannot tell why the rig started or stopped irrigating.
  if (mode && mode !== before) {
    const label = { AUTO: 'TỰ ĐỘNG', MANUAL: 'THỦ CÔNG', NONE: 'CHƯA CHỌN' }[mode];
    createAlert('info', `Chế độ đổi thành ${label} từ tủ điện / màn HMI`);
  }

  const status = getStatus();
  emit(EVENTS.STATUS, status);
  return status;
}

export function setMode(mode) {
  db.prepare(`UPDATE system_status SET mode = ? WHERE id = 1`).run(mode);
  emit(EVENTS.STATUS, getStatus());
}

// Seconds between two actuators when the whole panel is switched on at once.
// Five pump motors closing together is an inrush the panel should never have to
// swallow, and the relay board's supply is shared.
export const PANEL_STAGGER_SECONDS = 2;

// Queue the same action for every actuator on the panel.
//
// Valves are always ordered BEFORE pumps. That mirrors the AUTO state machine in
// esp32_master.ino (AUTO_OPEN_VALVE -> wait -> AUTO_START_PUMP): a pump started
// against a shut valve is dead-heading into a closed line.
//
// staggerSeconds spreads the batch out. It is 0 for the emergency stop on
// purpose — cutting power is the one case that must happen all at once.
// Returns the delay given to the LAST command, so a caller can queue a
// follow-up that lands after the whole batch has been applied.
export function enqueueAllDevices(action, { staggerSeconds = 0 } = {}) {
  const present = new Set(db.prepare(`SELECT id FROM devices`).all().map((r) => r.id));
  const ordered = [...VALVE_IDS, ...PUMP_IDS].filter((id) => present.has(id));
  // Anything the operator added by hand still gets switched, just last.
  for (const id of present) if (!ordered.includes(id)) ordered.push(id);

  ordered.forEach((id, i) => enqueueCommand(id, action, { delaySeconds: i * staggerSeconds }));
  return ordered.length ? (ordered.length - 1) * staggerSeconds : 0;
}

// ---- Emergency stop --------------------------------------------------------
export function isEStopEngaged() {
  return !!db.prepare(`SELECT e_stop FROM system_status WHERE id = 1`).get()
    ?.e_stop;
}

// The red "DỪNG KHẨN CẤP" bar on the CONTROL screen. Engaging it must leave the
// field in a state nothing can re-energise on its own:
//   1. queue OFF for every actuator (the ESP32 applies them on its next poll),
//   2. park the system in MANUAL so runAutomation() can't undo step 1,
//   3. shout about it in the alert feed.
// While engaged, runAutomation() is inert and the control endpoint refuses ON.
// Releasing it does NOT restart anything — the operator goes back to AUTO by
// hand once they know why they hit the button.
export function setEmergencyStop(engaged, actor = 'người dùng') {
  db.prepare(`UPDATE system_status SET e_stop = ? WHERE id = 1`).run(
    engaged ? 1 : 0
  );

  if (engaged) {
    enqueueAllDevices('OFF');
    enqueueCommand('mode', 'MANUAL');
    setMode('MANUAL');
    createAlert(
      'danger',
      `DỪNG KHẨN CẤP: đã tắt toàn bộ bơm và van, chuyển sang chế độ THỦ CÔNG (${actor})`
    );
  } else {
    createAlert(
      'info',
      `Đã gỡ DỪNG KHẨN CẤP (${actor}) — hệ thống vẫn ở chế độ THỦ CÔNG`
    );
  }

  const status = getStatus();
  emit(EVENTS.STATUS, status);
  return status;
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

// ---- Command queue ---------------------------------------------------------
// Statuses that still represent "the master owes us this action".
const LIVE_COMMAND_STATUSES = `('pending', 'sent')`;

// Queue a command, replacing anything still outstanding for the same device.
// Pressing ON then OFF must leave ONE instruction, not two that replay in order.
// delaySeconds holds the command back in the queue: it is 'pending' but the
// master is not offered it until then. Used to stagger a whole-panel switch-on.
export function enqueueCommand(deviceId, action, { delaySeconds = 0 } = {}) {
  db.prepare(
    `UPDATE commands SET status = 'superseded'
     WHERE device_id = ? AND status IN ${LIVE_COMMAND_STATUSES}`
  ).run(deviceId);

  const info = db
    .prepare(
      `INSERT INTO commands (device_id, action, run_after)
       VALUES (?, ?, CASE WHEN ? > 0 THEN datetime('now', ?) ELSE NULL END)`
    )
    .run(deviceId, action, delaySeconds, `+${delaySeconds} seconds`);
  return db.prepare(`SELECT * FROM commands WHERE id = ?`).get(info.lastInsertRowid);
}

export function hasLiveCommand(deviceId) {
  return !!db
    .prepare(
      `SELECT 1 FROM commands WHERE device_id = ?
       AND status IN ${LIVE_COMMAND_STATUSES} LIMIT 1`
    )
    .get(deviceId);
}

// Keeps the queue honest. Runs before every poll AND on a timer, so a device
// recovers even while the master is away.
export function sweepCommands() {
  const { commandRetrySeconds, commandMaxAttempts, commandTtlSeconds } = config;

  // 1. Handed out but never acked -> offer it again (master rebooted mid-command).
  const retried = db
    .prepare(
      `UPDATE commands SET status = 'pending', sent_at = NULL, attempts = attempts + 1
       WHERE status = 'sent' AND attempts < ?
         AND sent_at <= datetime('now', ?)`
    )
    .run(commandMaxAttempts, `-${commandRetrySeconds} seconds`);

  // 2. Retried too many times -> stop looping, let automation move on.
  const failed = db
    .prepare(
      `UPDATE commands SET status = 'failed'
       WHERE status = 'sent' AND attempts >= ?
         AND sent_at <= datetime('now', ?)`
    )
    .run(commandMaxAttempts, `-${commandRetrySeconds} seconds`);

  // 3. Queued while the master was offline for ages -> don't replay stale intent
  //    at whatever the field looks like now.
  const expired = db
    .prepare(
      `UPDATE commands SET status = 'expired'
       WHERE status = 'pending' AND created_at <= datetime('now', ?)`
    )
    .run(`-${commandTtlSeconds} seconds`);

  const changed = retried.changes + failed.changes + expired.changes;
  if (changed > 0) {
    if (failed.changes)
      createAlert('warning', `${failed.changes} lệnh không được xác nhận sau ${commandMaxAttempts} lần thử`);
    if (expired.changes)
      createAlert('info', `${expired.changes} lệnh quá hạn đã bị hủy (master offline quá lâu)`);
  }
  return changed;
}

// Housekeeping. At ~1 reading every 2.5s a node writes ~35k telemetry rows a
// day, so without this the file grows without bound.
export function pruneOldData() {
  const closed = db
    .prepare(
      `DELETE FROM commands
       WHERE status NOT IN ${LIVE_COMMAND_STATUSES}
         AND created_at <= datetime('now', ?)`
    )
    .run(`-${config.commandHistoryDays} days`);

  let telemetry = { changes: 0 };
  if (config.telemetryRetentionDays > 0) {
    telemetry = db
      .prepare(`DELETE FROM telemetry WHERE created_at <= datetime('now', ?)`)
      .run(`-${config.telemetryRetentionDays} days`);
  }

  let alerts = { changes: 0 };
  if (config.alertRetentionDays > 0) {
    alerts = db
      .prepare(`DELETE FROM alerts WHERE created_at <= datetime('now', ?)`)
      .run(`-${config.alertRetentionDays} days`);
  }

  const total = closed.changes + telemetry.changes + alerts.changes;
  if (total > 0) {
    console.log(
      `[prune] telemetry ${telemetry.changes}, alerts ${alerts.changes}, commands ${closed.changes}`
    );
  }
  return total;
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
// A bound that is null / '' / not a number means "no limit on that side" — the
// Settings screen lets an operator clear one half of a MIN/MAX pair.
const bound = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isBelow = (value, min) => {
  const b = bound(min);
  return value != null && b != null && value < b;
};
const isAbove = (value, max) => {
  const b = bound(max);
  return value != null && b != null && value > b;
};

// `reading` is a telemetry row already enriched with level1..level4.
export function checkThresholds(reading) {
  const cfg = getConfig();
  const t = cfg.thresholds;
  const { ph, ec, temperature, humidity, n, p, k } = reading;

  const check = (key, active, level, message) =>
    active ? raise(key, level, message) : clearCondition(key);

  check('ph-low', isBelow(ph, t.phMin), 'warning',
    `pH ${ph} thấp hơn ngưỡng (${t.phMin})`);
  check('ph-high', isAbove(ph, t.phMax), 'warning',
    `pH ${ph} cao hơn ngưỡng (${t.phMax})`);
  // EC stays in µS/cm end to end; only the HMI divides by 1000 to show mS/cm.
  check('ec-low', isBelow(ec, t.ecMin), 'warning',
    `EC ${ec} µS/cm thấp hơn ngưỡng (${t.ecMin} µS/cm)`);
  check('ec-high', isAbove(ec, t.ecMax), 'warning',
    `EC ${ec} µS/cm cao hơn ngưỡng (${t.ecMax} µS/cm)`);
  check('temp-low', isBelow(temperature, t.tempMin), 'warning',
    `Nhiệt độ ${temperature}°C thấp hơn ngưỡng (${t.tempMin}°C)`);
  check('temp-high', isAbove(temperature, t.tempMax), 'danger',
    `Nhiệt độ ${temperature}°C cao hơn ngưỡng (${t.tempMax}°C)`);
  check('humidity-low', isBelow(humidity, t.humidityMin), 'warning',
    `Độ ẩm đất ${humidity}% thấp hơn ngưỡng (${t.humidityMin}%)`);
  check('humidity-high', isAbove(humidity, t.humidityMax), 'warning',
    `Độ ẩm đất ${humidity}% cao hơn ngưỡng (${t.humidityMax}%)`);

  check('n-low', isBelow(n, t.nMin), 'warning',
    `Đạm (N) ${n} ppm thấp hơn ngưỡng (${t.nMin})`);
  check('p-low', isBelow(p, t.pMin), 'warning',
    `Lân (P) ${p} ppm thấp hơn ngưỡng (${t.pMin})`);
  check('k-low', isBelow(k, t.kMin), 'warning',
    `Kali (K) ${k} ppm thấp hơn ngưỡng (${t.kMin})`);

  TANK_IDS.forEach((distKey, i) => {
    const tank = cfg.tanks?.[distKey];
    if (!tank?.enabled) return clearCondition(`tank-${i + 1}`);
    const pct = reading[`level${i + 1}`];
    check(`tank-${i + 1}`, isBelow(pct, t.tankLowPct), 'danger',
      `${tank.name} còn ${pct}% — dưới ngưỡng (${t.tankLowPct}%)`);
    check(`tank-${i + 1}-err`, reading[distKey] == null, 'warning',
      `${tank.name}: cảm biến siêu âm không phản hồi`);
  });
}

// ---- Irrigation short-cycle guard (PUMPS ONLY) -----------------------------
// A rule whose metric hovers around its threshold would otherwise slam a pump
// ON/OFF every few seconds and cook the motor. `irrigation` in the app config
// bounds that:
//
//   runMinutes  — once a pump goes ON, no AUTO rule may switch it OFF until
//                 this many minutes have passed (minimum watering time).
//   restMinutes — once a pump goes OFF, no AUTO rule may switch it ON again
//                 until this many minutes have passed (cool-down).
//
// Only the AUTO engine is held back. A human pressing ON/OFF (MANUAL mode or
// POST /api/devices/:id/command) is never blocked — the guard protects the
// hardware from a jittery sensor, not from its operator. Valves are unaffected:
// they cost nothing to cycle.
//
// The two timestamps live in the devices table so the guard survives a restart,
// and are stamped both when AUTO *decides* on a transition and when the device
// state actually flips (ack from the master / state report), whichever is first.
// A NULL timestamp means "no constraint on that side" — a device that has never
// run can start immediately.
function markPumpTransition(id, action) {
  if (!PUMP_IDS.includes(id)) return;
  const column = action === 'ON' ? 'last_on_at' : 'last_off_at';
  db.prepare(
    `UPDATE devices SET ${column} = datetime('now') WHERE id = ?`
  ).run(id);
}

const minutesSince = (ts) =>
  ts == null ? Infinity : (Date.now() - new Date(ts + 'Z').getTime()) / 60000;

// Returns a Vietnamese reason string when the transition must be suppressed,
// or null when AUTO is free to act.
function irrigationBlock(deviceId, desired, irrigation) {
  if (!PUMP_IDS.includes(deviceId)) return null;
  const row = db
    .prepare(`SELECT last_on_at, last_off_at FROM devices WHERE id = ?`)
    .get(deviceId);
  if (!row) return null;

  const runMinutes = Number(irrigation?.runMinutes) || 0;
  const restMinutes = Number(irrigation?.restMinutes) || 0;

  if (desired === 'OFF' && runMinutes > 0) {
    const elapsed = minutesSince(row.last_on_at);
    if (elapsed < runMinutes)
      return `chưa đủ thời gian tưới tối thiểu ${runMinutes} phút (còn ${Math.ceil(runMinutes - elapsed)} phút)`;
  }
  if (desired === 'ON' && restMinutes > 0) {
    const elapsed = minutesSince(row.last_off_at);
    if (elapsed < restMinutes)
      return `đang trong thời gian nghỉ ${restMinutes} phút (còn ${Math.ceil(restMinutes - elapsed)} phút)`;
  }
  return null;
}

// ---- AUTO-mode automation engine -------------------------------------------
// Metrics a rule may reference. Raw probe values (soil + air + rain) plus the
// derived tank levels.
export const AUTOMATION_METRICS = [
  'temperature', 'humidity', 'ph', 'ec', 'n', 'p', 'k',
  'air_temp', 'air_humidity', 'rain',
  'dist1', 'dist2', 'dist3', 'dist4',
  'level1', 'level2', 'level3', 'level4',
];

// On each telemetry reading, when the system is in AUTO mode, evaluate every
// enabled rule. If a device's desired state differs from its current state and
// there's no pending command yet, enqueue a command for the ESP32 to execute.
export function runAutomation(reading) {
  // Emergency stop wins over everything: the whole point is that nothing turns
  // itself back on while someone is standing in the field.
  if (isEStopEngaged()) return;
  if (getStatus().mode !== 'AUTO') return;
  const cfg = getConfig();
  const automation = cfg.automation;

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

    // Skip while an instruction for this device is still outstanding. Only
    // 'pending'/'sent' count — expired and failed ones must not block forever.
    if (hasLiveCommand(deviceId)) continue;

    // Short-cycle guard. Uses raise() so a pump held back for 15 minutes logs
    // once per alert window instead of once per reading.
    const blockKey = `irrigation-${deviceId}-${desired}`;
    const blocked = irrigationBlock(deviceId, desired, cfg.irrigation);
    if (blocked) {
      raise(blockKey, 'info', `AUTO: giữ ${deviceId} ở ${current} — ${blocked}`);
      continue;
    }
    clearCondition(blockKey);

    enqueueCommand(deviceId, desired);
    markPumpTransition(deviceId, desired);
    createAlert(
      'info',
      `AUTO: ${deviceId} → ${desired} (${rule.metric} ${metricValue} ${rule.op} ${rule.value})`
    );
  }
}
