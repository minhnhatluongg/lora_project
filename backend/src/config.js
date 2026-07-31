import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim()),
  deviceApiKey: process.env.DEVICE_API_KEY || '',
  jwtSecret: process.env.JWT_SECRET || 'changeme-jwt-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
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
  telemetryRetentionDays: Number(process.env.TELEMETRY_RETENTION_DAYS ?? 90),
  alertRetentionDays: Number(process.env.ALERT_RETENTION_DAYS ?? 30),
  thresholds: {
    phMin: Number(process.env.PH_MIN) || 5.5,
    phMax: Number(process.env.PH_MAX) || 7.5,
    // EC is stored exactly as the RS485 probe reports it: µS/cm (uint16).
    ecMax: Number(process.env.EC_MAX) || 2500,
    tempMax: Number(process.env.TEMP_MAX) || 40,
    humidityMin: Number(process.env.HUMIDITY_MIN) || 30,
    // NPK (mg/kg) — probe registers 5..7
    nMin: Number(process.env.N_MIN) || 50,
    pMin: Number(process.env.P_MIN) || 30,
    kMin: Number(process.env.K_MIN) || 60,
    // Ultrasonic tanks: warn below this fill level (%)
    tankLowPct: Number(process.env.TANK_LOW_PCT) || 20,
  },
};
