import { Router } from 'express';
import { db } from '../db.js';
import { deviceAuth, asyncH } from '../middleware.js';
import { requireAuth, canControl } from '../auth.js';
import { getDevices, setDeviceState } from '../services.js';

export const devicesRouter = Router();

// List all actuators with their current state.
devicesRouter.get(
  '/',
  requireAuth,
  asyncH((req, res) => {
    res.json(getDevices());
  })
);

// Frontend requests a device change -> enqueue a command for the ESP32.
// Body: { action: 'ON' | 'OFF' }   (admin/technician only)
devicesRouter.post(
  '/:id/command',
  requireAuth,
  canControl,
  asyncH((req, res) => {
    const { id } = req.params;
    const action = String(req.body?.action || '').toUpperCase();

    const device = db.prepare(`SELECT id FROM devices WHERE id = ?`).get(id);
    if (!device) return res.status(404).json({ error: 'Unknown device' });
    if (!['ON', 'OFF'].includes(action))
      return res.status(400).json({ error: "action must be 'ON' or 'OFF'" });

    const info = db
      .prepare(`INSERT INTO commands (device_id, action) VALUES (?, ?)`)
      .run(id, action);

    res.status(202).json({
      id: info.lastInsertRowid,
      device_id: id,
      action,
      status: 'pending',
    });
  })
);

// ESP32 master reports the ACTUAL device states it read back from the slave.
// Body: { pump: 'ON', van1: 'OFF', ... }  (or numeric 0/1 / boolean)
devicesRouter.post(
  '/state',
  deviceAuth,
  asyncH((req, res) => {
    const body = req.body || {};
    const toBool = (v) =>
      v === 1 || v === '1' || v === true || String(v).toUpperCase() === 'ON';
    let updated = 0;
    for (const [id, val] of Object.entries(body)) {
      if (setDeviceState(id, toBool(val))) updated++;
    }
    res.json({ updated, devices: getDevices() });
  })
);
