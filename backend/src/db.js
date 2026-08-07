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

db.exec(`
  -- One row per reading of the STM32 node:
  --   * 7 Modbus registers from the RS485 soil probe (T/H/EC/pH/N/P/K)
  --   * 4 ultrasonic tank distances (cm, NULL when the echo timed out)
  CREATE TABLE IF NOT EXISTS telemetry (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    temperature REAL,      -- °C   (raw / 10)
    humidity    REAL,      -- %    (raw / 10)
    ph          REAL,      -- pH   (raw / 10)
    ec          REAL,      -- µS/cm (raw, as the probe reports it)
    n           INTEGER,   -- mg/kg
    p           INTEGER,   -- mg/kg
    k           INTEGER,   -- mg/kg
    dist1       REAL,      -- cm
    dist2       REAL,
    dist3       REAL,
    dist4       REAL,
    lora_rssi   INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry (created_at);

  -- Current state of every actuator (pump + 4 valves)
  CREATE TABLE IF NOT EXISTS devices (
    id         TEXT PRIMARY KEY,   -- 'pump', 'van1'..'van4'
    name       TEXT NOT NULL,
    state      INTEGER NOT NULL DEFAULT 0,  -- 0 = OFF, 1 = ON
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Single-row system status table (id is always 1)
  CREATE TABLE IF NOT EXISTS system_status (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    mode            TEXT NOT NULL DEFAULT 'AUTO',   -- AUTO | MANUAL
    slave_online    INTEGER NOT NULL DEFAULT 0,
    lora_rssi       INTEGER,
    master_seen_at  TEXT,
    slave_seen_at   TEXT,
    sensor_status   TEXT,           -- 'OK' | 'CRC' | 'HEADER' | 'TIMEOUT' | 'SHORT'
    sensor_error_at TEXT
  );

  -- Command queue: frontend enqueues, ESP32 master polls + acks.
  -- status: pending -> sent -> acked, or -> expired / superseded / failed.
  -- A command that is handed out but never acked goes back to 'pending' so a
  -- master that reboots mid-command doesn't leave the device stuck forever.
  CREATE TABLE IF NOT EXISTS commands (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   TEXT NOT NULL,        -- 'pump','van1'..'van4','mode'
    action      TEXT NOT NULL,        -- 'ON' | 'OFF' | 'AUTO' | 'MANUAL'
    status      TEXT NOT NULL DEFAULT 'pending',
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
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
});
addMissingColumns('system_status', {
  sensor_status: 'TEXT',
  sensor_error_at: 'TEXT',
});
addMissingColumns('commands', {
  attempts: 'INTEGER NOT NULL DEFAULT 0',
  sent_at: 'TEXT',
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

// --- Seed default rows if missing -------------------------------------------
const defaultDevices = [
  { id: 'pump', name: 'Bơm nước' },
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
  `INSERT OR IGNORE INTO system_status (id, mode, slave_online) VALUES (1, 'AUTO', 0)`
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

  // Ultrasonic sensors measure the air gap from the sensor down to the water.
  //   emptyCm = distance read when the tank is empty (sensor -> bottom)
  //   fullCm  = distance read when the tank is full  (sensor -> full water line)
  // Fill level % = (emptyCm - distance) / (emptyCm - fullCm) * 100, clamped 0..100.
  // A fertigation rig: two nutrient tanks, a water tank and the mixing tank.
  // ECHO1..ECHO4 on the STM32 map to these in order; rename in the web UI.
  tanks: {
    dist1: { name: 'Bồn Kali', enabled: true, emptyCm: 100, fullCm: 15 },
    dist2: { name: 'Bồn Đạm', enabled: true, emptyCm: 100, fullCm: 15 },
    dist3: { name: 'Bồn Nước', enabled: true, emptyCm: 100, fullCm: 15 },
    dist4: { name: 'Trộn', enabled: true, emptyCm: 100, fullCm: 15 },
  },

  // For each device: in AUTO mode turn ON when <metric> is <op> <value>, else OFF.
  automation: {
    pump: { enabled: false, metric: 'humidity', op: 'below', value: 40 },
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
  const merged = {
    thresholds: { ...defaultConfig.thresholds, ...(saved.thresholds || {}) },
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
