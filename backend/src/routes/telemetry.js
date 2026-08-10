import { Router } from 'express';
import { db } from '../db.js';
import { deviceAuth, asyncH } from '../middleware.js';
import { requireAuth } from '../auth.js';
import { emit, EVENTS } from '../realtime.js';
import {
  touchMaster,
  checkThresholds,
  runAutomation,
  withLevels,
  withLevelsAll,
  getStatus,
} from '../services.js';

export const telemetryRouter = Router();

const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// The STM32 returns -1.0 from readUltrasonic() when pulseIn() times out
// (no echo / out of the 400 cm range). Store that as NULL, not as a distance.
const distance = (v) => {
  const n = num(v);
  return n == null || n < 0 ? null : n;
};

// The rain board comes in two flavours in the field: an analogue one that
// reports a wetness percentage, and a digital one that only says "raining".
// Normalise the boolean form to the ends of the same 0..100 scale so the HMI
// has a single field to read.
const rainValue = (v) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v ? 100 : 0;
  const word = String(v).trim().toLowerCase();
  if (word === 'true' || word === 'yes') return 100;
  if (word === 'false' || word === 'no') return 0;
  return num(v);
};

// Accept both the short field names and the firmware's own variable names, so
// the ESP32 bridge can forward whichever it finds easier to build.
const pick = (body, ...names) => {
  for (const name of names) {
    if (body[name] !== undefined) return body[name];
  }
  return undefined;
};

// ESP32 master posts a sensor reading here — one full sweep of the STM32 node:
// 7 Modbus registers from the RS485 soil probe, the air probe + rain board,
// and 4 ultrasonic distances.
telemetryRouter.post(
  '/',
  deviceAuth,
  asyncH((req, res) => {
    const b = req.body || {};

    const reading = {
      temperature: num(pick(b, 'temperature', 'temp', 'Temperature')),
      humidity: num(pick(b, 'humidity', 'hum', 'Humidity')),
      ph: num(pick(b, 'ph', 'pH', 'pH_Value')),
      ec: num(pick(b, 'ec', 'EC', 'EC_Value')), // µS/cm, exactly as the probe reports
      n: num(pick(b, 'n', 'N', 'nitrogen', 'Nitrogen')),
      p: num(pick(b, 'p', 'P', 'phosphorus', 'Phosphorus')),
      k: num(pick(b, 'k', 'K', 'potassium', 'Potassium')),
      // Air probe + rain board. Like every other field these are optional: a
      // node without them simply omits them and the row keeps NULLs, rather
      // than recording a fake 0 that would trip the thresholds.
      air_temp: num(pick(b, 'air_temp', 'airTemp', 'air_temperature', 'AirTemp', 'temp_air')),
      air_humidity: num(pick(b, 'air_humidity', 'airHumidity', 'air_hum', 'airHum', 'AirHumidity', 'hum_air')),
      rain: rainValue(pick(b, 'rain', 'rain_pct', 'rainPct', 'raining', 'Rain')),
      dist1: distance(pick(b, 'dist1', 'd1', 'Dist1')),
      dist2: distance(pick(b, 'dist2', 'd2', 'Dist2')),
      dist3: distance(pick(b, 'dist3', 'd3', 'Dist3')),
      dist4: distance(pick(b, 'dist4', 'd4', 'Dist4')),
    };

    const loraRssi = num(pick(b, 'lora_rssi', 'rssi'));
    const slaveOnline = pick(b, 'slave_online', 'slaveOnline');
    // 'OK' | 'CRC' | 'HEADER' | 'TIMEOUT' | 'SHORT' — mirrors the STM32's
    // Modbus error branches so the dashboard can show *why* data went stale.
    const sensorStatus = pick(b, 'sensor_status', 'status');

    const info = db
      .prepare(
        `INSERT INTO telemetry
           (temperature, humidity, ph, ec, n, p, k,
            air_temp, air_humidity, rain,
            dist1, dist2, dist3, dist4, lora_rssi)
         VALUES (@temperature, @humidity, @ph, @ec, @n, @p, @k,
                 @air_temp, @air_humidity, @rain,
                 @dist1, @dist2, @dist3, @dist4, @lora_rssi)`
      )
      .run({ ...reading, lora_rssi: loraRssi });

    const row = withLevels(
      db.prepare(`SELECT * FROM telemetry WHERE id = ?`).get(info.lastInsertRowid)
    );

    touchMaster({
      loraRssi,
      slaveOnline: slaveOnline === undefined ? undefined : !!slaveOnline,
      sensorStatus: sensorStatus ? String(sensorStatus).toUpperCase() : undefined,
    });
    checkThresholds(row);
    runAutomation(row);

    emit(EVENTS.TELEMETRY, row);
    // Master/slave liveness and the Modbus link state just changed — push the
    // refreshed status so the dashboard badges don't wait for a poll.
    emit(EVENTS.STATUS, getStatus());
    res.status(201).json(row);
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
    res.json(row ? withLevels(row) : null);
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
    res.json(withLevelsAll(rows));
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
    res.json(withLevelsAll(rows));
  })
);
