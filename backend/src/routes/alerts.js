import { Router } from 'express';
import { db } from '../db.js';
import { deviceAuth, asyncH } from '../middleware.js';
import { requireAuth } from '../auth.js';
import { createAlert } from '../services.js';

export const alertsRouter = Router();

// Recent alerts for the dashboard. ?limit=20
alertsRouter.get(
  '/',
  requireAuth,
  asyncH((req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 200);
    const rows = db
      .prepare(`SELECT * FROM alerts ORDER BY id DESC LIMIT ?`)
      .all(limit);
    res.json(rows);
  })
);

// Allow the ESP32 (or anything) to push a custom alert.
// Body: { level: 'info'|'warning'|'danger', message }
alertsRouter.post(
  '/',
  deviceAuth,
  asyncH((req, res) => {
    const { level = 'info', message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message required' });
    res.status(201).json(createAlert(level, message));
  })
);
