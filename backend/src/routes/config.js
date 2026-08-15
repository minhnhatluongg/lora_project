import { Router } from 'express';
import { asyncH, deviceAuth } from '../middleware.js';
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

// POST /api/config/thresholds -> the ESP32 reporting the ten values an operator
// just entered on the Nextion, so the web SETTINGS screen shows what the panel
// is actually running on rather than a stale copy.
//
// Device-authenticated (x-api-key): the master has no user account. It sends a
// FLAT body with the firmware's own names, which differ from ours in three
// places, hence the explicit mapping rather than a spread:
//
//     humMin/humMax  -> thresholds.humidityMin/humidityMax
//     timeBom        -> irrigation.runMinutes
//     timeNghi       -> irrigation.restMinutes
//
// EC needs no conversion: the sketch compares ecMin/ecMax against the raw
// EC_Value from the RS485 probe, which is µS/cm — the same unit we store.
//
// Every field is optional. A key that is absent or unusable leaves the stored
// value alone, so a partial or half-garbled packet can never blank the config.
const THRESHOLD_FIELDS = {
  phMin: 'phMin',
  phMax: 'phMax',
  ecMin: 'ecMin',
  ecMax: 'ecMax',
  tempMin: 'tempMin',
  tempMax: 'tempMax',
  humMin: 'humidityMin',
  humMax: 'humidityMax',
};

configRouter.post(
  '/thresholds',
  deviceAuth,
  asyncH((req, res) => {
    const body = req.body || {};
    const current = getConfig();

    const thresholds = { ...current.thresholds };
    for (const [from, to] of Object.entries(THRESHOLD_FIELDS)) {
      const n = Number(body[from]);
      if (Number.isFinite(n)) thresholds[to] = n;
    }

    const irrigation = { ...current.irrigation };
    irrigation.runMinutes = minutes(body.timeBom, irrigation.runMinutes);
    irrigation.restMinutes = minutes(body.timeNghi, irrigation.restMinutes);

    res.json(setConfig({ ...current, thresholds, irrigation }));
  })
);
