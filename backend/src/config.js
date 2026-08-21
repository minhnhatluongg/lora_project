import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim()),
  deviceApiKey: process.env.DEVICE_API_KEY || '',
  jwtSecret: process.env.JWT_SECRET || 'changeme-jwt-secret',
  // 2 giờ, không phải 12. Token là JWT không trạng thái nên thời gian sống CHÍNH
  // LÀ cửa sổ rủi ro nếu nó bị lộ; cột users.token_valid_after chỉ thu hồi được
  // khi ai đó chủ động đổi mật khẩu, còn hạn ngắn thì tự đóng cửa sổ đó lại.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
  seedAdmin: {
    username: process.env.SEED_ADMIN_USERNAME || 'admin',
    password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
  },
  dbFile: process.env.DB_FILE || './data/farm.db',
  masterTimeoutSeconds: Number(process.env.MASTER_TIMEOUT_SECONDS) || 30,
  // Don't re-raise the same threshold alert more often than this.
  alertRepeatSeconds: Number(process.env.ALERT_REPEAT_SECONDS) || 600,

  // Command queue reliability
  commandRetrySeconds: Number(process.env.COMMAND_RETRY_SECONDS) || 30,
  commandMaxAttempts: Number(process.env.COMMAND_MAX_ATTEMPTS) || 3,
  commandTtlSeconds: Number(process.env.COMMAND_TTL_SECONDS) || 300,
  commandHistoryDays: Number(process.env.COMMAND_HISTORY_DAYS) || 7,

  // Housekeeping. Set TELEMETRY_RETENTION_DAYS=0 to keep everything forever.
  //
  // 7 days, not 90. The ESP32 posts every 3 seconds once it is wired to a real
  // probe -- 28,800 rows a day, so 90 days is 2.6 million rows of a reading
  // nobody looks back at. Seven matches the longest range the charts offer
  // ("7 ngày" in RealtimeCharts), so nothing the UI can ask for is missing.
  telemetryRetentionDays: Number(process.env.TELEMETRY_RETENTION_DAYS ?? 7),
  alertRetentionDays: Number(process.env.ALERT_RETENTION_DAYS ?? 30),
  // Every sensor the HMI shows is a MIN/MAX pair — the panel's "CÀI ĐẶT NGƯỠNG"
  // screen edits both halves. A blank/null bound means "no limit on that side".
  thresholds: {
    phMin: Number(process.env.PH_MIN) || 5.5,
    phMax: Number(process.env.PH_MAX) || 7.5,
    // EC is stored exactly as the RS485 probe reports it: µS/cm (uint16).
    // The HMI shows mS/cm, so the frontend divides by 1000 — never the DB.
    ecMin: Number(process.env.EC_MIN) || 0,
    ecMax: Number(process.env.EC_MAX) || 2500,
    tempMin: Number(process.env.TEMP_MIN) || 15,
    tempMax: Number(process.env.TEMP_MAX) || 40,
    humidityMin: Number(process.env.HUMIDITY_MIN) || 30,
    humidityMax: Number(process.env.HUMIDITY_MAX) || 90,
    // NPK (mg/kg) — probe registers 5..7
    nMin: Number(process.env.N_MIN) || 50,
    pMin: Number(process.env.P_MIN) || 30,
    kMin: Number(process.env.K_MIN) || 60,
    // Ultrasonic tanks: warn below this fill level (%)
    tankLowPct: Number(process.env.TANK_LOW_PCT) || 20,
  },

  // Watering cycle defaults (minutes) — seed the app config on FIRST run only.
  // See the short-cycle guard in services.js for what they actually do.
  irrigation: {
    runMinutes: Number(process.env.IRRIGATION_RUN_MINUTES) || 15,
    restMinutes: Number(process.env.IRRIGATION_REST_MINUTES) || 45,
  },
};
