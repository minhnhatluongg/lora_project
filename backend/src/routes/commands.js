import { Router } from 'express';
import { db } from '../db.js';
import { deviceAuth, asyncH } from '../middleware.js';
import { setDeviceState, setMode, touchMaster } from '../services.js';

export const commandsRouter = Router();

// ESP32 master polls this to fetch pending commands, then relays them via LoRa.
// Marks them 'sent' so they aren't returned twice.
commandsRouter.get(
  '/pending',
  deviceAuth,
  asyncH((req, res) => {
    touchMaster();
    const pending = db
      .prepare(`SELECT * FROM commands WHERE status = 'pending' ORDER BY id ASC`)
      .all();
    if (pending.length) {
      const ids = pending.map((c) => c.id);
      db.prepare(
        `UPDATE commands SET status = 'sent'
         WHERE id IN (${ids.map(() => '?').join(',')})`
      ).run(...ids);
    }
    res.json(pending);
  })
);

// ESP32 master acks that a command was executed by the slave.
// Body: { id, success?: true }
commandsRouter.post(
  '/:id/ack',
  deviceAuth,
  asyncH((req, res) => {
    const id = Number(req.params.id);
    const cmd = db.prepare(`SELECT * FROM commands WHERE id = ?`).get(id);
    if (!cmd) return res.status(404).json({ error: 'Unknown command' });

    db.prepare(
      `UPDATE commands SET status = 'acked', acked_at = datetime('now') WHERE id = ?`
    ).run(id);

    // Reflect the confirmed change in our own state tables.
    if (cmd.device_id === 'mode') {
      setMode(cmd.action); // 'AUTO' | 'MANUAL'
    } else {
      setDeviceState(cmd.device_id, cmd.action === 'ON');
    }

    res.json({ ok: true });
  })
);
