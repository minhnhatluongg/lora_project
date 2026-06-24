import { config } from './config.js';

// Protects write endpoints used by the ESP32 master.
// The device must send the key in the "x-api-key" header.
// If DEVICE_API_KEY is empty (dev mode), auth is skipped.
export function deviceAuth(req, res, next) {
  if (!config.deviceApiKey) return next();
  const key = req.get('x-api-key');
  if (key !== config.deviceApiKey) {
    return res.status(401).json({ error: 'Invalid or missing x-api-key' });
  }
  next();
}

// Wrap async route handlers so thrown errors hit the error middleware.
export const asyncH = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
