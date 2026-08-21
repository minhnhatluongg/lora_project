import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Ensure the data directory exists
const dbPath = path.resolve(config.dbFile);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL'); // better concurrency for frequent IoT writes

// SQLite mặc định TẮT khóa ngoại, nên ON DELETE CASCADE khai trong CREATE TABLE
// chỉ là chữ nghĩa suông nếu không bật dòng này. `tasks` là bảng duy nhất trong
// lược đồ có khóa ngoại (v10), nên bật lên không làm hỏng bảng nào sẵn có: xóa
// một tài khoản sẽ dọn luôn việc đã giao cho họ thay vì để lại việc mồ côi.
db.pragma('foreign_keys = ON');

db.exec(`
  -- One row per reading of the STM32 node:
  --   * 7 Modbus registers from the RS485 soil probe (T/H/EC/pH/N/P/K)
  --   * the air probe + rain board wired to the same node
  --   * 4 ultrasonic tank distances (cm, NULL when the echo timed out)
  CREATE TABLE IF NOT EXISTS telemetry (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    temperature  REAL,      -- °C   (raw / 10)
    humidity     REAL,      -- %    (raw / 10)
    ph           REAL,      -- pH   (raw / 10)
    ec           REAL,      -- µS/cm (raw, as the probe reports it)
    n            INTEGER,   -- mg/kg
    p            INTEGER,   -- mg/kg
    k            INTEGER,   -- mg/kg
    air_temp     REAL,      -- °C   (air, not soil)
    air_humidity REAL,      -- %RH  (air, not soil)
    rain         REAL,      -- %    (0 = dry .. 100 = soaked; a digital board sends 0/100)
    dist1        REAL,      -- cm
    dist2        REAL,
    dist3        REAL,
    dist4        REAL,
    lora_rssi    INTEGER,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry (created_at);

  -- Current state of every actuator (5 pumps + 4 valves).
  -- last_on_at / last_off_at drive the irrigation short-cycle guard; see
  -- services.js for the semantics.
  CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,   -- 'pump1'..'pump5', 'van1'..'van4'
    name        TEXT NOT NULL,
    state       INTEGER NOT NULL DEFAULT 0,  -- 0 = OFF, 1 = ON
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_on_at  TEXT,
    last_off_at TEXT
  );

  -- Single-row system status table (id is always 1)
  CREATE TABLE IF NOT EXISTS system_status (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    -- Fail-safe: a fresh rig comes up with NO mode picked, which locks every
    -- output. Both AUTO and MANUAL drive real pumps, so running the panel is
    -- always an explicit choice by an operator, never a default. Mirrors
    -- esp32_master.ino, where systemMode starts at -1 ("chưa chọn").
    mode            TEXT NOT NULL DEFAULT 'NONE',    -- NONE | AUTO | MANUAL
    slave_online    INTEGER NOT NULL DEFAULT 0,
    lora_rssi       INTEGER,
    master_seen_at  TEXT,
    slave_seen_at   TEXT,
    sensor_status   TEXT,           -- 'OK' | 'CRC' | 'HEADER' | 'TIMEOUT' | 'SHORT'
    sensor_error_at TEXT,
    e_stop          INTEGER NOT NULL DEFAULT 0, -- 1 = DỪNG KHẨN CẤP engaged
    -- What the field engine is actually doing, reported by the master. The AUTO
    -- and mixing state machines live on the ESP32 and run with no network, so
    -- without this the dashboard can only show "AUTO" and a row of dead
    -- switches — it cannot say which step is in progress.
    auto_state      TEXT,           -- AUTO_IDLE | AUTO_OPEN_VALVE | ...
    mix_state       TEXT,           -- MIX_IDLE | MIX_ADD_WATER | ...
    mix_ready       INTEGER NOT NULL DEFAULT 0,
    engine_seen_at  TEXT
  );

  -- Command queue: frontend enqueues, ESP32 master polls + acks.
  -- status: pending -> sent -> acked, or -> expired / superseded / failed.
  -- A command that is handed out but never acked goes back to 'pending' so a
  -- master that reboots mid-command doesn't leave the device stuck forever.
  CREATE TABLE IF NOT EXISTS commands (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   TEXT NOT NULL,        -- 'pump1'..'pump5','van1'..'van4','mode','system'
    action      TEXT NOT NULL,        -- 'ON' | 'OFF' | 'AUTO' | 'MANUAL' | 'RESTART'
    status      TEXT NOT NULL DEFAULT 'pending',
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    -- Earliest moment this may be handed to the master. NULL = right away.
    -- Lets a batch be spread over time (see enqueueAllDevices) instead of
    -- hitting the panel with nine simultaneous relay closures.
    run_after   TEXT,
    sent_at     TEXT,
    acked_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_commands_status ON commands (status);

  CREATE TABLE IF NOT EXISTS alerts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    level      TEXT NOT NULL,   -- info | warning | danger
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts (created_at);

  -- Application users with roles
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    full_name     TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'viewer',  -- admin | technician | viewer
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Single-row JSON config: alert thresholds + tank calibration + AUTO rules
  CREATE TABLE IF NOT EXISTS app_config (
    id    INTEGER PRIMARY KEY CHECK (id = 1),
    data  TEXT NOT NULL
  );

  -- Key/value store for schema-version bookkeeping
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// --- Migrations for databases created by an earlier version -----------------
function addMissingColumns(table, columns) {
  const existing = new Set(
    db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
  );
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
      console.log(`[db] migrated: ${table}.${name} added`);
    }
  }
}

addMissingColumns('telemetry', {
  n: 'INTEGER',
  p: 'INTEGER',
  k: 'INTEGER',
  dist1: 'REAL',
  dist2: 'REAL',
  dist3: 'REAL',
  dist4: 'REAL',
  // Air probe + rain board added alongside the soil probe.
  air_temp: 'REAL',
  air_humidity: 'REAL',
  rain: 'REAL',
});
addMissingColumns('system_status', {
  sensor_status: 'TEXT',
  sensor_error_at: 'TEXT',
  e_stop: 'INTEGER NOT NULL DEFAULT 0',
});
addMissingColumns('commands', {
  attempts: 'INTEGER NOT NULL DEFAULT 0',
  sent_at: 'TEXT',
});
addMissingColumns('devices', {
  last_on_at: 'TEXT',
  last_off_at: 'TEXT',
});

const getMeta = (key) =>
  db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key)?.value;
const setMeta = (key, value) =>
  db
    .prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`)
    .run(key, String(value));

// v2: EC is now stored in µS/cm (what the probe actually reports) instead of
// mS/cm. Scale up the handful of old rows so history charts stay continuous.
if (Number(getMeta('schema_version') || 1) < 2) {
  const info = db.prepare(`UPDATE telemetry SET ec = ec * 1000 WHERE ec < 50`).run();
  if (info.changes > 0)
    console.log(`[db] migrated: ${info.changes} EC rows mS/cm -> µS/cm`);
  setMeta('schema_version', 2);
}

// v3: before the retry/expiry sweep existed, any command handed to a master
// that then rebooted stayed 'sent' forever — and automation skips a device that
// has a non-acked command, so that device went dead. Clear the backlog once.
if (Number(getMeta('schema_version') || 1) < 3) {
  const info = db
    .prepare(`UPDATE commands SET status = 'expired' WHERE status = 'sent'`)
    .run();
  if (info.changes > 0)
    console.log(`[db] migrated: released ${info.changes} stuck 'sent' commands`);
  setMeta('schema_version', 3);
}

// v4: the rig grew from one pump to five. RENAME the old 'pump' row to 'pump1'
// so its state (and its row identity) survives — an INSERT + DELETE would flip
// a running pump to OFF in the UI for one poll. pump2..pump5 come from the
// default-device seed a few lines below (INSERT OR IGNORE, so it is a no-op for
// anything that already exists). Command history is rewritten too, otherwise an
// in-flight 'pump' command would ack against a device id that no longer exists.
if (Number(getMeta('schema_version') || 1) < 4) {
  const legacy = db.prepare(`SELECT * FROM devices WHERE id = 'pump'`).get();
  if (legacy) {
    const clash = db.prepare(`SELECT 1 FROM devices WHERE id = 'pump1'`).get();
    if (clash) {
      // Both ids somehow present (hand-edited DB): pump1 wins, drop the old row.
      db.prepare(`DELETE FROM devices WHERE id = 'pump'`).run();
      console.log(`[db] migrated: dropped legacy 'pump' row, 'pump1' already existed`);
    } else {
      db.prepare(
        `UPDATE devices SET id = 'pump1', name = 'Bơm 1' WHERE id = 'pump'`
      ).run();
      console.log(
        `[db] migrated: device 'pump' -> 'pump1' (state ${legacy.state ? 'ON' : 'OFF'} preserved)`
      );
    }
  }
  const cmds = db
    .prepare(`UPDATE commands SET device_id = 'pump1' WHERE device_id = 'pump'`)
    .run();
  if (cmds.changes > 0)
    console.log(`[db] migrated: ${cmds.changes} lệnh 'pump' -> 'pump1'`);
  setMeta('schema_version', 4);
}

// v5: the first two ultrasonic sensors were labelled the wrong way round. The
// hardware team confirmed ECHO1 is the nitrogen tank and ECHO2 the potassium
// one, not the reverse. Swap the stored names — but ONLY where they still hold
// the old defaults, so an operator who already renamed a tank keeps their name.
if (Number(getMeta('schema_version') || 1) < 5) {
  const row = db.prepare(`SELECT data FROM app_config WHERE id = 1`).get();
  if (row) {
    const cfg = JSON.parse(row.data);
    if (cfg.tanks?.dist1?.name === 'Bồn Kali' && cfg.tanks?.dist2?.name === 'Bồn Đạm') {
      cfg.tanks.dist1.name = 'Bồn Đạm';
      cfg.tanks.dist2.name = 'Bồn Kali';
      db.prepare(`UPDATE app_config SET data = ? WHERE id = 1`).run(JSON.stringify(cfg));
      console.log(`[db] migrated: đổi tên bồn dist1 -> Bồn Đạm, dist2 -> Bồn Kali`);
    }
  }
  setMeta('schema_version', 5);
}

// v6: a fresh install used to come up in AUTO, which meant the automation engine
// was armed before anyone asked for it. AUTO commands real pumps and valves, so
// it must be a deliberate choice. Flip existing databases over to MANUAL once.
// Unconditional on purpose: MANUAL is the fail-safe direction, and there is no
// way to tell "never touched" from "deliberately set to AUTO" in the stored row.
// An operator who wants AUTO back just presses TỰ ĐỘNG on the CONTROL screen.
if (Number(getMeta('schema_version') || 1) < 6) {
  const flipped = db
    .prepare(`UPDATE system_status SET mode = 'MANUAL' WHERE id = 1 AND mode <> 'MANUAL'`)
    .run();
  if (flipped.changes > 0)
    console.log(`[db] migrated: chế độ mặc định AUTO -> THỦ CÔNG (bật AUTO bằng tay khi cần)`);
  setMeta('schema_version', 6);
}

// v7: mode gained a third value. v6 parked everyone in MANUAL, but MANUAL still
// hands an operator live ON/OFF switches the moment the screen opens. 'NONE'
// means nobody has picked yet and every output stays locked until they do —
// the same three-state model esp32_master.ino already uses (-1 / 0 / 1).
// Unconditional for the same reason as v6: 'NONE' is the fail-safe direction
// and a stored row cannot tell a deliberate choice from a leftover default.
if (Number(getMeta('schema_version') || 1) < 7) {
  const cleared = db
    .prepare(`UPDATE system_status SET mode = 'NONE' WHERE id = 1 AND mode <> 'NONE'`)
    .run();
  if (cleared.changes > 0)
    console.log(`[db] migrated: bỏ chọn chế độ (NONE) — chọn THỦ CÔNG hoặc TỰ ĐỘNG để mở khoá`);
  setMeta('schema_version', 7);
}

// v8: commands gained run_after so a batch can be spread out in time. Existing
// databases need the column added; every row already in the queue keeps NULL,
// which means "no delay" — identical to the old behaviour.
if (Number(getMeta('schema_version') || 1) < 8) {
  const hasColumn = db
    .prepare(`SELECT 1 FROM pragma_table_info('commands') WHERE name = 'run_after'`)
    .get();
  if (!hasColumn) {
    db.prepare(`ALTER TABLE commands ADD COLUMN run_after TEXT`).run();
    console.log(`[db] migrated: thêm cột commands.run_after (giãn cách lệnh theo thời gian)`);
  }
  setMeta('schema_version', 8);
}

// v9: the dashboard could show WHICH mode the panel was in but never what the
// field engine was doing inside it. Four columns carry the master's report so
// the CONTROL screen can draw the mixing and irrigation steps as they happen.
if (Number(getMeta('schema_version') || 1) < 9) {
  const have = new Set(
    db.prepare(`SELECT name FROM pragma_table_info('system_status')`).all().map((r) => r.name)
  );
  const added = [];
  for (const [col, decl] of [
    ['auto_state', `ALTER TABLE system_status ADD COLUMN auto_state TEXT`],
    ['mix_state', `ALTER TABLE system_status ADD COLUMN mix_state TEXT`],
    ['mix_ready', `ALTER TABLE system_status ADD COLUMN mix_ready INTEGER NOT NULL DEFAULT 0`],
    ['engine_seen_at', `ALTER TABLE system_status ADD COLUMN engine_seen_at TEXT`],
  ]) {
    if (!have.has(col)) { db.prepare(decl).run(); added.push(col); }
  }
  if (added.length)
    console.log(`[db] migrated: thêm ${added.join(', ')} vào system_status`);
  setMeta('schema_version', 9);
}

// v10: giao việc giữa người với người. Ba vai trò vốn chỉ dùng để chặn quyền
// bấm nút; từ đây chúng còn là một trật tự phân việc — admin giao được cho cấp
// dưới, kĩ thuật giao cho người xem (xem canAssign trong auth.js).
//
// Bảng này KHÔNG dính gì tới bảng `alerts`. Cảnh báo là do cảm biến sinh ra, ai
// đăng nhập cũng thấy như nhau, và cũ đi thì tự trôi. Việc thì có người nhận
// đích danh, có hạn, và phải nằm đó cho tới khi ai đó đánh dấu xong — gộp chung
// một bảng là hai vòng đời đánh nhau.
if (Number(getMeta('schema_version') || 1) < 10) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      body        TEXT,
      -- ON DELETE CASCADE cho người nhận: xóa tài khoản thì việc của họ đi theo,
      -- không để lại việc mồ côi không ai mở được.
      assignee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- Người giao thì ngược lại: giữ việc, chỉ mất tên người giao. Ai đang làm
      -- dở vẫn phải thấy việc của mình dù người giao đã nghỉ.
      assigner_id INTEGER          REFERENCES users(id) ON DELETE SET NULL,
      priority    TEXT NOT NULL DEFAULT 'normal',  -- low | normal | high
      status      TEXT NOT NULL DEFAULT 'new',     -- new | doing | done
      due_at      TEXT,                            -- hạn chót; quá hạn thì báo đỏ
      seen_at     TEXT,                            -- lần đầu người nhận mở ra xem
      done_at     TEXT,
      result_note TEXT,                            -- người làm ghi lại khi xong
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Truy vấn nóng nhất là "việc chưa xong của tôi", chạy mỗi lần vẽ huy hiệu đỏ.
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (assignee_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_assigner ON tasks (assigner_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks (due_at);
  `);
  console.log(`[db] migrated: thêm bảng tasks (giao việc theo vai trò)`);
  setMeta('schema_version', 10);
}

// v11: thu hồi phiên đăng nhập.
//
// Token đăng nhập là JWT không trạng thái — máy chủ không giữ danh sách phiên
// nào cả, nên trước đây KHÔNG có cách nào chấm dứt một phiên trước hạn. Khóa
// tài khoản, đổi mật khẩu, thậm chí bấm "Đăng xuất" đều không đụng được tới cái
// token đã phát ra: nó sống đủ 12 tiếng dù có chuyện gì xảy ra.
//
// Cột này là cái mốc: mọi token phát TRƯỚC thời điểm ghi ở đây đều bị từ chối.
// Một cột, không cần bảng phiên, không cần Redis — nhưng đủ để đổi mật khẩu là
// mọi phiên khác chết ngay.
// NULL = chưa từng thu hồi, mọi token còn hạn đều dùng được.
if (Number(getMeta('schema_version') || 1) < 11) {
  const has = db
    .prepare(`SELECT 1 FROM pragma_table_info('users') WHERE name = 'token_valid_after'`)
    .get();
  if (!has) {
    db.prepare(`ALTER TABLE users ADD COLUMN token_valid_after TEXT`).run();
    console.log(`[db] migrated: thêm cột users.token_valid_after (thu hồi phiên)`);
  }
  setMeta('schema_version', 11);
}

// --- Seed default rows if missing -------------------------------------------
// Five pumps and four valves, matching the relay board on the panel drawing.
const defaultDevices = [
  { id: 'pump1', name: 'Bơm 1' },
  { id: 'pump2', name: 'Bơm 2' },
  { id: 'pump3', name: 'Bơm 3' },
  { id: 'pump4', name: 'Bơm 4' },
  { id: 'pump5', name: 'Bơm 5' },
  { id: 'van1', name: 'Van 1' },
  { id: 'van2', name: 'Van 2' },
  { id: 'van3', name: 'Van 3' },
  { id: 'van4', name: 'Van 4' },
];

const insertDevice = db.prepare(
  `INSERT OR IGNORE INTO devices (id, name, state) VALUES (?, ?, 0)`
);
for (const d of defaultDevices) insertDevice.run(d.id, d.name);

db.prepare(
  `INSERT OR IGNORE INTO system_status (id, mode, slave_online) VALUES (1, 'NONE', 0)`
).run();

// Default admin user (only if no users exist yet)
const userCount = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
if (userCount === 0) {
  const hash = bcrypt.hashSync(config.seedAdmin.password, 10);
  db.prepare(
    `INSERT INTO users (username, full_name, password_hash, role)
     VALUES (?, 'Administrator', ?, 'admin')`
  ).run(config.seedAdmin.username, hash);
  console.log(
    `[db] Seeded default admin: ${config.seedAdmin.username} / ${config.seedAdmin.password}`
  );
}

// --- Default app config ------------------------------------------------------
export const defaultConfig = {
  thresholds: { ...config.thresholds },

  // Watering cycle for the pumps, in minutes. Enforced by the AUTO engine as a
  // short-cycle guard (services.js) — not a timer that runs pumps on its own.
  irrigation: { ...config.irrigation },

  // Ultrasonic sensors measure the air gap from the sensor down to the water.
  //   emptyCm = distance read when the tank is empty (sensor -> bottom)
  //   fullCm  = distance read when the tank is full  (sensor -> full water line)
  // Fill level % = (emptyCm - distance) / (emptyCm - fullCm) * 100, clamped 0..100.
  // A fertigation rig: two nutrient tanks, a water tank and the mixing tank.
  // Order confirmed against the physical wiring by the hardware team:
  //   ECHO1 (PB13) = Đạm | ECHO2 (PB14) = Kali | ECHO3 (PB15) = Nước | ECHO4 (PA8) = Trộn
  // Rename in SETTINGS if a sensor is ever moved.
  tanks: {
    dist1: { name: 'Bồn Đạm', enabled: true, emptyCm: 100, fullCm: 15 },
    dist2: { name: 'Bồn Kali', enabled: true, emptyCm: 100, fullCm: 15 },
    dist3: { name: 'Bồn Nước', enabled: true, emptyCm: 100, fullCm: 15 },
    dist4: { name: 'Trộn', enabled: true, emptyCm: 100, fullCm: 15 },
  },

  // For each device: in AUTO mode turn ON when <metric> is <op> <value>, else OFF.
  automation: {
    pump1: { enabled: false, metric: 'humidity', op: 'below', value: 40 },
    pump2: { enabled: false, metric: 'humidity', op: 'below', value: 35 },
    pump3: { enabled: false, metric: 'n', op: 'below', value: 50 },
    pump4: { enabled: false, metric: 'p', op: 'below', value: 30 },
    pump5: { enabled: false, metric: 'k', op: 'below', value: 60 },
    van1: { enabled: false, metric: 'humidity', op: 'below', value: 50 },
    van2: { enabled: false, metric: 'level1', op: 'below', value: 20 },
    van3: { enabled: false, metric: 'temperature', op: 'above', value: 35 },
    van4: { enabled: false, metric: 'ec', op: 'above', value: 2200 },
  },
};

// Insert on first run; on upgrade, fill in any section/key added since the DB
// was created without clobbering what the user already tuned.
const existingCfgRow = db.prepare(`SELECT data FROM app_config WHERE id = 1`).get();
if (!existingCfgRow) {
  db.prepare(`INSERT INTO app_config (id, data) VALUES (1, ?)`).run(
    JSON.stringify(defaultConfig)
  );
} else {
  const saved = JSON.parse(existingCfgRow.data);

  // v4 device rename: carry the old single-pump rule over to pump1, otherwise
  // the rebuild below (which is keyed on the new device ids) would silently
  // drop a rule the operator had tuned.
  if (saved.automation?.pump && !saved.automation.pump1) {
    saved.automation.pump1 = saved.automation.pump;
  }
  delete saved.automation?.pump;

  const merged = {
    thresholds: { ...defaultConfig.thresholds, ...(saved.thresholds || {}) },
    irrigation: { ...defaultConfig.irrigation, ...(saved.irrigation || {}) },
    tanks: Object.fromEntries(
      Object.entries(defaultConfig.tanks).map(([id, t]) => [
        id,
        { ...t, ...(saved.tanks?.[id] || {}) },
      ])
    ),
    automation: Object.fromEntries(
      Object.entries(defaultConfig.automation).map(([id, r]) => [
        id,
        { ...r, ...(saved.automation?.[id] || {}) },
      ])
    ),
  };
  // Old DBs expressed EC in mS/cm — bring the threshold and any EC-based
  // automation rule into µS/cm alongside the migrated readings.
  if (merged.thresholds.ecMax < 50) merged.thresholds.ecMax *= 1000;
  for (const rule of Object.values(merged.automation)) {
    if (rule.metric === 'ec' && rule.value < 50) rule.value *= 1000;
  }
  db.prepare(`UPDATE app_config SET data = ? WHERE id = 1`).run(
    JSON.stringify(merged)
  );
}
