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

// A watering time of "-5 phút" would make the short-cycle guard nonsense, and a
// blank field arrives as ''. Clamp to a non-negative number, keep what we had
// when the value is unusable.
const minutes = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// PUT /api/config -> update (admin/technician only).
// Body may contain { thresholds, irrigation, tanks, automation }. Sections merge
// shallowly; tanks/automation merge one level deeper so a partial rule keeps its
// other keys.
configRouter.put(
  '/',
  requireAuth,
  canConfig,
  asyncH((req, res) => {
    const current = getConfig();
    const body = req.body || {};

    const mergeEntries = (base, patch) => {
      const out = { ...base };
      for (const [id, value] of Object.entries(patch || {})) {
        out[id] = { ...(base[id] || {}), ...value };
      }
      return out;
    };

    const irrigation = { ...current.irrigation, ...(body.irrigation || {}) };
    irrigation.runMinutes = minutes(irrigation.runMinutes, current.irrigation?.runMinutes ?? 15);
    irrigation.restMinutes = minutes(irrigation.restMinutes, current.irrigation?.restMinutes ?? 45);

    const next = {
      thresholds: { ...current.thresholds, ...(body.thresholds || {}) },
      irrigation,
      tanks: mergeEntries(current.tanks, body.tanks),
      automation: mergeEntries(current.automation, body.automation),
    };
    res.json(setConfig(next));
  })
);
