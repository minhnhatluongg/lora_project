import { Router } from 'express';
import { db } from '../db.js';
import { deviceAuth, asyncH } from '../middleware.js';
import { setDeviceState, setMode, touchMaster, sweepCommands } from '../services.js';

export const commandsRouter = Router();

// ESP32 master polls this to fetch pending commands, then drives the actuators.
// Marks them 'sent' so they aren't handed out twice — but sweepCommands() will
// re-offer any that go unacked, so a master crashing here loses nothing.
commandsRouter.get(
  '/pending',
  deviceAuth,
  asyncH((req, res) => {
    touchMaster();
    sweepCommands();

    const pending = db
      .prepare(`SELECT * FROM commands WHERE status = 'pending' ORDER BY id ASC`)
      .all();
    if (pending.length) {
      const ids = pending.map((c) => c.id);
      db.prepare(
        `UPDATE commands SET status = 'sent', sent_at = datetime('now')
         WHERE id IN (${ids.map(() => '?').join(',')})`
      ).run(...ids);
    }
    res.json(pending);
  })
);

// ESP32 master acks that a command was executed.
// Body: { success?: true }
commandsRouter.post(
  '/:id/ack',
  deviceAuth,
  asyncH((req, res) => {
    const id = Number(req.params.id);
    const cmd = db.prepare(`SELECT * FROM commands WHERE id = ?`).get(id);
    if (!cmd) return res.status(404).json({ error: 'Unknown command' });

    // Retries mean the master can legitimately ack the same id twice.
    if (cmd.status === 'acked') return res.json({ ok: true, duplicate: true });

    // An explicit failure report frees the device instead of looping forever.
    if (req.body?.success === false) {
      db.prepare(`UPDATE commands SET status = 'failed' WHERE id = ?`).run(id);
      return res.json({ ok: true, failed: true });
    }

    db.prepare(
      `UPDATE commands SET status = 'acked', acked_at = datetime('now') WHERE id = ?`
    ).run(id);

    // The ack is ground truth from the hardware, so apply it even if this
    // command was superseded while in flight — a newer one will follow.
    if (cmd.device_id === 'mode') {
      setMode(cmd.action); // 'AUTO' | 'MANUAL'
    } else {
      setDeviceState(cmd.device_id, cmd.action === 'ON');
    }

    res.json({ ok: true });
  })
);
