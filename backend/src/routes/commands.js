import { Router } from 'express';
import { db } from '../db.js';
import { deviceAuth, asyncH } from '../middleware.js';
import { requireAuth } from '../auth.js';
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
      // Cái ack này ĐẾN TỪ phần cứng — nó chính là xác nhận, nên đánh dấu vào.
      setMode(cmd.action, { confirmed: true }); // 'AUTO' | 'MANUAL' | 'NONE'
    } else {
      setDeviceState(cmd.device_id, cmd.action === 'ON');
    }

    res.json({ ok: true });
  })
);

// Nhật ký lệnh gần đây, kèm bốn mốc thời gian của mỗi lệnh. ?limit=25
//
// Bảng `commands` xưa nay ghi đủ created_at -> run_after -> sent_at -> acked_at
// và số lần thử, nhưng không màn hình nào đọc tới. Đó là chỗ tiếc: chính bốn
// mốc đó cho thấy vì sao phải có hàng đợi thay vì gọi thẳng xuống ESP32 —
// ESP32 nằm sau NAT, server không mở kết nối tới nó được, nên lệnh phải NẰM
// CHỜ tới lượt nó hỏi.
//
// Các quãng thời gian tính ở đây chứ không ở trình duyệt: chúng lấy mốc từ
// datetime('now') của SQLite, nên phải trừ nhau trong cùng một đồng hồ. Đưa
// bốn chuỗi thô cho trình duyệt tự trừ là mời đúng cái lỗi lệch múi giờ.
commandsRouter.get(
  '/recent',
  requireAuth,
  asyncH((req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const rows = db
      .prepare(
        `SELECT id, device_id, action, status, attempts,
                created_at, run_after, sent_at, acked_at,
                -- Giữ hàng: từ lúc xếp hàng tới lúc ESP32 thật sự lấy đi.
                CASE WHEN sent_at IS NOT NULL
                     THEN ROUND((julianday(sent_at) - julianday(created_at)) * 86400.0, 1) END AS wait_s,
                -- Thực thi: từ lúc ESP32 nhận tới lúc rơ-le báo đã làm xong.
                CASE WHEN acked_at IS NOT NULL AND sent_at IS NOT NULL
                     THEN ROUND((julianday(acked_at) - julianday(sent_at)) * 86400.0, 1) END AS run_s,
                -- Trọn vòng: bấm nút cho tới khi phần cứng xác nhận.
                CASE WHEN acked_at IS NOT NULL
                     THEN ROUND((julianday(acked_at) - julianday(created_at)) * 86400.0, 1) END AS total_s,
                -- Phần bị GIỮ LẠI có chủ ý (giãn cách bật cả dàn), tách khỏi
                -- phần chờ do ESP32 chưa hỏi tới — hai thứ khác hẳn nhau.
                CASE WHEN run_after IS NOT NULL
                     THEN ROUND((julianday(run_after) - julianday(created_at)) * 86400.0, 1) END AS hold_s
           FROM commands
          ORDER BY id DESC
          LIMIT ?`
      )
      .all(limit);

    res.json(
      rows.map((r) => ({
        id: r.id,
        deviceId: r.device_id,
        action: r.action,
        status: r.status,
        attempts: r.attempts,
        createdAt: r.created_at,
        runAfter: r.run_after,
        sentAt: r.sent_at,
        ackedAt: r.acked_at,
        holdSeconds: r.hold_s,
        waitSeconds: r.wait_s,
        runSeconds: r.run_s,
        totalSeconds: r.total_s,
      }))
    );
  })
);
