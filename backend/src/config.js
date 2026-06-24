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
  thresholds: {
    phMin: Number(process.env.PH_MIN) || 5.5,
    phMax: Number(process.env.PH_MAX) || 7.5,
    ecMax: Number(process.env.EC_MAX) || 2.5,
    tempMax: Number(process.env.TEMP_MAX) || 40,
    humidityMin: Number(process.env.HUMIDITY_MIN) || 30,
  },
};
