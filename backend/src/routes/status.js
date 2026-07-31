import { Router } from 'express';
import { asyncH } from '../middleware.js';
import { requireAuth, canControl } from '../auth.js';
import { getStatus, setMode, enqueueCommand } from '../services.js';

export const statusRouter = Router();

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

    enqueueCommand('mode', mode);
    setMode(mode);
    res.json(getStatus());
  })
);
