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
  CREATE TABLE IF NOT EXISTS telemetry (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    temperature REAL,
    humidity    REAL,
    ph          REAL,
    ec          REAL,
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
    slave_seen_at   TEXT
  );

  -- Command queue: frontend enqueues, ESP32 master polls + acks
  CREATE TABLE IF NOT EXISTS commands (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   TEXT NOT NULL,        -- 'pump','van1'..'van4','mode'
    action      TEXT NOT NULL,        -- 'ON' | 'OFF' | 'AUTO' | 'MANUAL'
    status      TEXT NOT NULL DEFAULT 'pending', -- pending | sent | acked
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
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

  -- Single-row JSON config: alert thresholds + AUTO-mode automation rules
  CREATE TABLE IF NOT EXISTS app_config (
    id    INTEGER PRIMARY KEY CHECK (id = 1),
    data  TEXT NOT NULL
  );
`);

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

// Default config (thresholds from env + automation rules per device, disabled)
const defaultConfig = {
  thresholds: {
    phMin: config.thresholds.phMin,
    phMax: config.thresholds.phMax,
    ecMax: config.thresholds.ecMax,
    tempMax: config.thresholds.tempMax,
    humidityMin: config.thresholds.humidityMin,
  },
  // For each device: in AUTO mode turn ON when <metric> is <op> <value>, else OFF.
  automation: {
    pump: { enabled: false, metric: 'humidity', op: 'below', value: 40 },
    van1: { enabled: false, metric: 'humidity', op: 'below', value: 50 },
    van2: { enabled: false, metric: 'humidity', op: 'below', value: 50 },
    van3: { enabled: false, metric: 'temperature', op: 'above', value: 35 },
    van4: { enabled: false, metric: 'ec', op: 'above', value: 2.2 },
  },
};
db.prepare(`INSERT OR IGNORE INTO app_config (id, data) VALUES (1, ?)`).run(
  JSON.stringify(defaultConfig)
);
