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

    // ?limit=1 lets a master that can only execute one command at a time (the
    // ESP32 waits for the Nano's LoRa ACK before sending the next) take exactly
    // what it can act on. Without it every queued command is marked 'sent' and
    // the unexecuted ones only come back after the retry timeout.
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 100));

    // run_after holds a command back without taking it out of the queue, so a
    // whole-panel switch-on arrives spread over time however fast the master
    // polls and whatever limit it asks for.
    const pending = db
      .prepare(
        `SELECT * FROM commands
         WHERE status = 'pending' AND (run_after IS NULL OR run_after <= datetime('now'))
         ORDER BY id ASC LIMIT ?`
      )
      .all(limit);
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
