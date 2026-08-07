import { Router } from 'express';
import { asyncH } from '../middleware.js';
import { requireAuth, canControl, adminOnly } from '../auth.js';
import { defaultConfig } from '../db.js';
import { enqueueCommand, createAlert, setConfig, getConfig } from '../services.js';

export const systemRouter = Router();

// POST /api/system/restart  (admin/technician)
// The two blue/orange buttons on the SETTINGS screen act on the FIELD unit, not
// on this server: killing the Node process would take the dashboard down with
// it and nothing would be listening when the ESP32 came back. So we queue a
// command the master picks up on its next poll and reboots itself with.
systemRouter.post(
  '/restart',
  requireAuth,
  canControl,
  asyncH((req, res) => {
    const cmd = enqueueCommand('system', 'RESTART');
    createAlert(
      'info',
      `Yêu cầu khởi động lại hệ thống đã được gửi tới ESP32 (${req.user?.username || 'người dùng'})`
    );
    res.json({ ok: true, queued: true, commandId: cmd.id });
  })
);

// POST /api/system/restore-defaults  (admin only)
// "KHÔI PHỤC CÀI ĐẶT TRƯỚC": puts thresholds, watering times, tank calibration
// and automation rules back to the factory values from db.js. Deliberately
// destructive on app_config ONLY — users, telemetry history and the alert log
// are left alone, so this is a settings reset and not a factory wipe.
systemRouter.post(
  '/restore-defaults',
  requireAuth,
  adminOnly,
  asyncH((req, res) => {
    const fresh = JSON.parse(JSON.stringify(defaultConfig));
    setConfig(fresh);
    createAlert(
      'warning',
      `Đã khôi phục toàn bộ cài đặt về mặc định (${req.user?.username || 'người dùng'})`
    );
    res.json(getConfig());
  })
);
