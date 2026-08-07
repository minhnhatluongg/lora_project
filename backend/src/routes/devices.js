import { Router } from 'express';
import { db } from '../db.js';
import { deviceAuth, asyncH } from '../middleware.js';
import { requireAuth, canControl } from '../auth.js';
import {
  getDevices,
  setDeviceState,
  enqueueCommand,
  resolveDeviceId,
  isEStopEngaged,
} from '../services.js';

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
    // 'pump' is the pre-five-pump id; an un-reflashed ESP32 still uses it.
    const id = resolveDeviceId(req.params.id);
    const action = String(req.body?.action || '').toUpperCase();

    const device = db.prepare(`SELECT id FROM devices WHERE id = ?`).get(id);
    if (!device) return res.status(404).json({ error: 'Unknown device' });
    if (!['ON', 'OFF'].includes(action))
      return res.status(400).json({ error: "action must be 'ON' or 'OFF'" });

    // Emergency stop only inhibits energising something — turning things OFF
    // must always get through, including while the button is latched.
    if (action === 'ON' && isEStopEngaged())
      return res.status(409).json({
        error: 'Đang DỪNG KHẨN CẤP — không thể bật thiết bị. Hãy gỡ dừng khẩn cấp trước.',
        eStop: true,
      });

    // Replaces any instruction still outstanding for this device, so mashing
    // the button doesn't queue up a sequence that replays later.
    res.status(202).json(enqueueCommand(id, action));
  })
);

// ESP32 master reports the ACTUAL device states it read back from the slave.
// Body: { pump1: 'ON', van1: 'OFF', ... }  (or numeric 0/1 / boolean)
// Legacy 'pump' is accepted and applied to pump1.
devicesRouter.post(
  '/state',
  deviceAuth,
  asyncH((req, res) => {
    const body = req.body || {};
    const toBool = (v) =>
      v === 1 || v === '1' || v === true || String(v).toUpperCase() === 'ON';
    let updated = 0;
    for (const [id, val] of Object.entries(body)) {
      if (setDeviceState(resolveDeviceId(id), toBool(val))) updated++;
    }
    res.json({ updated, devices: getDevices() });
  })
);
