import { Router } from 'express';
import { asyncH } from '../middleware.js';
import { requireAuth, canConfig } from '../auth.js';
import { getConfig, setConfig } from '../services.js';

export const configRouter = Router();

// GET /api/config -> thresholds + automation rules (any logged-in user can read)
configRouter.get(
  '/',
  requireAuth,
  asyncH((req, res) => {
    res.json(getConfig());
  })
);

// PUT /api/config -> update (admin/technician only).
// Body may contain { thresholds, automation } (partial merge supported).
configRouter.put(
  '/',
  requireAuth,
  canConfig,
  asyncH((req, res) => {
    const current = getConfig();
    const body = req.body || {};
    const next = {
      thresholds: { ...current.thresholds, ...(body.thresholds || {}) },
      automation: { ...current.automation, ...(body.automation || {}) },
    };
    res.json(setConfig(next));
  })
);
