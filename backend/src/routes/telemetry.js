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
//
// `limit` là SỐ ĐIỂM VẼ trải đều khung thời gian, không phải "lấy bấy nhiêu
// dòng đầu tiên". Khác biệt này không phải chuyện thẩm mỹ:
//
// Bản trước viết `ORDER BY created_at ASC LIMIT 500`, tức là 500 dòng CŨ NHẤT
// trong khung. ESP32 đẩy số lên mỗi 3 giây, nên 500 dòng chỉ là 25 phút — biểu
// đồ "24 giờ" sẽ vẽ đúng 25 phút của hôm qua rồi đứng im, còn số mới nhất không
// bao giờ lọt vào. Lỗi này ẩn suốt thời gian dữ liệu còn thưa (dưới 500 dòng
// một ngày thì LIMIT không cắt gì cả) và chỉ lộ ra khi cắm phần cứng thật.
//
// Cách sửa: cắt khung thành `limit` ô thời gian rồi lấy MỘT lần đo trong mỗi ô.
// Lấy bản ghi CUỐI mỗi ô (MAX(id)) chứ không lấy trung bình: trung bình sinh ra
// những con số chưa từng đo được, mà mỗi dòng ở đây còn được `withLevels` tô màu
// theo ngưỡng — một giá trị bịa có thể che mất lần chạm ngưỡng thật.
telemetryRouter.get(
  '/history',
  requireAuth,
  asyncH((req, res) => {
    // Chặn trên 8760 giờ (1 năm): quá số này thì `datetime('now', ?)` vẫn chạy
    // nhưng chẳng còn dữ liệu nào, chỉ tốn một lần quét bảng.
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 8760);
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 2), 5000);
    const bucketSeconds = Math.max(1, Math.ceil((hours * 3600) / limit));

    const rows = db
      .prepare(
        `WITH win AS (
           SELECT * FROM telemetry WHERE created_at >= datetime('now', ?)
         )
         SELECT * FROM win
          WHERE id IN (
            SELECT MAX(id) FROM win
             -- CAST(? AS INTEGER) không thừa. Số JS gắn vào truy vấn là số
             -- THỰC, mà INTEGER / REAL trong SQLite là phép chia thực — mỗi
             -- dòng rơi vào một ô riêng và cả phép gộp thành vô nghĩa (đo được:
             -- 28.794 điểm thay vì 500). Ép về số nguyên mới ra phép chia lấy
             -- nguyên, tức là chia ô thật.
             GROUP BY CAST(strftime('%s', created_at) AS INTEGER) / CAST(? AS INTEGER)
          )
          ORDER BY created_at ASC`
      )
      .all(`-${hours} hours`, bucketSeconds);

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
