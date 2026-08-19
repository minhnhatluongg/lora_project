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

// POST /api/system/fetch-now
// "Lấy dữ liệu ngay" on the dashboard. The STM32 only transmits when asked, so
// without this an operator waits out the poll interval to see a fresh reading.
// The master translates this into <A:GET_DATA> on the LoRa link — the same thing
// the b2 button on the Nextion dashboard does, just reachable from the web.
//
// Any logged-in user may press it: it reads, it does not actuate anything.
systemRouter.post(
  '/fetch-now',
  requireAuth,
  asyncH((req, res) => {
    // Superseding is what we want here rather than a queue of identical
    // requests: two people pressing it three seconds apart should cost one LoRa
    // transaction, not six. enqueueCommand already supersedes outstanding
    // commands for the same device id, and the master dedupes again on its side.
    const cmd = enqueueCommand('system', 'GET_DATA');
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
