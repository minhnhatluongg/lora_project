import { Router } from 'express';
import { asyncH } from '../middleware.js';
import { requireAuth, canControl } from '../auth.js';
import {
  getStatus,
  setMode,
  enqueueCommand,
  setEmergencyStop,
  isEStopEngaged,
} from '../services.js';

export const statusRouter = Router();

// The panel sends a real JSON boolean, but a curl/ESP32 caller may send 1/0 or
// the strings — accept those, reject anything we'd have to guess at.
const asBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return null;
};

// System status: master/slave online, LoRa RSSI, operating mode.
statusRouter.get(
  '/',
  requireAuth,
  asyncH((req, res) => {
    res.json(getStatus());
  })
);

// Frontend switches AUTO/MANUAL. We both update our state AND enqueue a
// command so the ESP32 master learns about the change on its next poll.
statusRouter.post(
  '/mode',
  requireAuth,
  canControl,
  asyncH((req, res) => {
    const mode = String(req.body?.mode || '').toUpperCase();
    if (!['AUTO', 'MANUAL'].includes(mode))
      return res.status(400).json({ error: "mode must be 'AUTO' or 'MANUAL'" });

    // Going back to AUTO while the emergency stop is latched would show the
    // operator "TỰ ĐỘNG" on a system whose automation engine is inert. Refuse
    // instead of lying about it.
    if (mode === 'AUTO' && isEStopEngaged())
      return res.status(409).json({
        error: 'Đang DỪNG KHẨN CẤP — không thể bật chế độ TỰ ĐỘNG. Hãy gỡ dừng khẩn cấp trước.',
        eStop: true,
      });

    enqueueCommand('mode', mode);
    setMode(mode);
    res.json(getStatus());
  })
);

// Emergency stop latch — the red "DỪNG KHẨN CẤP" bar on the CONTROL screen.
// Body: { engaged: true | false }   (admin/technician)
// Engaging queues OFF for every actuator, forces MANUAL and raises a danger
// alert; while engaged nothing may be switched ON and AUTO stays inert.
statusRouter.post(
  '/estop',
  requireAuth,
  canControl,
  asyncH((req, res) => {
    const engaged = asBool(req.body?.engaged);
    if (engaged === null)
      return res.status(400).json({ error: 'engaged must be true or false' });

    res.json(setEmergencyStop(engaged, req.user?.username || 'người dùng'));
  })
);
