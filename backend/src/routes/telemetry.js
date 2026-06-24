import { Router } from 'express';
import { db } from '../db.js';
import { deviceAuth, asyncH } from '../middleware.js';
import { requireAuth } from '../auth.js';
import { emit, EVENTS } from '../realtime.js';
import { touchMaster, checkThresholds, runAutomation } from '../services.js';

export const telemetryRouter = Router();

// ESP32 master posts a sensor reading here.
// Body: { temperature, humidity, ph, ec, lora_rssi, slave_online }
telemetryRouter.post(
  '/',
  deviceAuth,
  asyncH((req, res) => {
    const { temperature, humidity, ph, ec, lora_rssi, slave_online } =
      req.body || {};

    const info = db
      .prepare(
        `INSERT INTO telemetry (temperature, humidity, ph, ec, lora_rssi)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(temperature, humidity, ph, ec, lora_rssi ?? null);

    const reading = db
      .prepare(`SELECT * FROM telemetry WHERE id = ?`)
      .get(info.lastInsertRowid);

    touchMaster({ loraRssi: lora_rssi, slaveOnline: slave_online });
    checkThresholds({ ph, ec, temperature, humidity });
    runAutomation({ ph, ec, temperature, humidity });

    emit(EVENTS.TELEMETRY, reading);
    res.status(201).json(reading);
  })
);

// Latest single reading (used by dashboard cards).
telemetryRouter.get(
  '/latest',
  requireAuth,
  asyncH((req, res) => {
    const row = db
      .prepare(`SELECT * FROM telemetry ORDER BY id DESC LIMIT 1`)
      .get();
    res.json(row || null);
  })
);

// History for charts. ?hours=24 (default) and optional ?limit.
telemetryRouter.get(
  '/history',
  requireAuth,
  asyncH((req, res) => {
    const hours = Number(req.query.hours) || 24;
    const limit = Math.min(Number(req.query.limit) || 500, 5000);
    const rows = db
      .prepare(
        `SELECT * FROM telemetry
         WHERE created_at >= datetime('now', ?)
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(`-${hours} hours`, limit);
    res.json(rows);
  })
);

// Most recent N rows for the "latest data" table. ?limit=10
telemetryRouter.get(
  '/recent',
  requireAuth,
  asyncH((req, res) => {
    const limit = Math.min(Number(req.query.limit) || 10, 200);
    const rows = db
      .prepare(`SELECT * FROM telemetry ORDER BY id DESC LIMIT ?`)
      .all(limit);
    res.json(rows);
  })
);
