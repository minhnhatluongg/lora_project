import { config } from './config.js';
import { requireAuth } from './auth.js';

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

// Read-only endpoints the ESP32 needs as much as the browser does. The master
// polls /api/status to learn that the emergency stop was engaged from the web,
// and it only ever carries the device key — requiring a JWT there would make the
// e-stop silently stop at the backend and never reach the relays.
export function deviceOrUserAuth(req, res, next) {
  const key = req.get('x-api-key');
  if (config.deviceApiKey && key === config.deviceApiKey) return next();
  if (!config.deviceApiKey && key !== undefined) return next(); // dev mode
  return requireAuth(req, res, next);
}

// Wrap async route handlers so thrown errors hit the error middleware.
export const asyncH = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
