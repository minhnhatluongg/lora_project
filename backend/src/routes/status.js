import { Router } from 'express';
import { asyncH, deviceOrUserAuth } from '../middleware.js';
import { requireAuth, canControl } from '../auth.js';
import {
  getStatus,
  setMode,
  enqueueCommand,
  enqueueAllDevices,
  PANEL_STAGGER_SECONDS,
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
// Readable by a logged-in browser OR by the ESP32 with its device key — the
// master polls this to find out the web engaged the emergency stop.
statusRouter.get(
  '/',
  deviceOrUserAuth,
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

    // Picking AUTO energises the whole panel — valves first, two seconds apart —
    // and only then hands control over.
    //
    // The ORDER is load-bearing: nano_relay.ino refuses every manual ON once it
    // is already in AUTO ("KHÓA AN TOÀN"), and esp32_master.ino rejects them one
    // step earlier for the same reason. Queued after the mode change these nine
    // commands would all come back refused; queued ahead of it they are still
    // seen as manual presses and are applied.
    //
    // Being last in the queue is not enough on its own: a master polling with a
    // high ?limit would collect the mode change in the same batch as the first
    // pump. So the mode command gets a run_after one step past the final
    // actuator, which orders it in TIME as well as in id.
    let modeDelay = 0;
    if (mode === 'AUTO') {
      modeDelay =
        enqueueAllDevices('ON', { staggerSeconds: PANEL_STAGGER_SECONDS }) +
        PANEL_STAGGER_SECONDS;
    }

    enqueueCommand('mode', mode, { delaySeconds: modeDelay });
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
