import { Router } from 'express';
import { db } from '../db.js';
import { asyncH } from '../middleware.js';
import { requireAuth, canAssignTo, canAssignAtAll } from '../auth.js';
import { emit, EVENTS } from '../realtime.js';

export const tasksRouter = Router();

// Giao việc giữa người với người. Mọi endpoint đều cần đăng nhập — không có
// đường nào cho thiết bị, vì ESP32 không giao việc cho ai.
tasksRouter.use(requireAuth);

const PRIORITIES = ['low', 'normal', 'high'];
const STATUSES = ['new', 'doing', 'done'];

// Gửi ra cho trình duyệt: kèm tên người để danh sách khỏi phải gọi thêm
// /api/users — người xem không có quyền gọi endpoint đó (nó là adminOnly).
const SELECT_TASK = `
  SELECT t.*,
         ae.username  AS assignee_username,
         ae.full_name AS assignee_name,
         ar.username  AS assigner_username,
         ar.full_name AS assigner_name
    FROM tasks t
    LEFT JOIN users ae ON ae.id = t.assignee_id
    LEFT JOIN users ar ON ar.id = t.assigner_id
`;

const publicTask = (t) => ({
  id: t.id,
  title: t.title,
  body: t.body || '',
  status: t.status,
  priority: t.priority,
  dueAt: t.due_at,
  seenAt: t.seen_at,
  doneAt: t.done_at,
  resultNote: t.result_note || '',
  createdAt: t.created_at,
  updatedAt: t.updated_at,
  assignee: { id: t.assignee_id, username: t.assignee_username, fullName: t.assignee_name },
  assigner: t.assigner_id
    ? { id: t.assigner_id, username: t.assigner_username, fullName: t.assigner_name }
    : null,
});

const getTask = (id) => db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(id);

// Ai được đụng vào một việc: người nhận, người giao, hoặc admin.
const mayTouch = (task, user) =>
  user.role === 'admin' || task.assignee_id === user.sub || task.assigner_id === user.sub;

// Một sự kiện TRỐNG, cố ý. Socket hiện chưa xác thực (client nối vào không kèm
// token, server không có phòng riêng theo người), nên đẩy nội dung việc qua đó
// là phát cho tất cả mọi người đang mở trang. Ở đây chỉ báo "có gì đó đổi", còn
// mỗi client tự gọi lại REST bằng token của mình và chỉ nhận đúng phần của họ.
const ping = () => emit(EVENTS.TASKS, { at: new Date().toISOString() });

const nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// --- Đọc ---------------------------------------------------------------------

// GET /api/tasks/summary -> con số cho huy hiệu đỏ
// Đặt TRƯỚC '/:id' — nếu không Express khớp 'summary' vào :id và trả 404.
tasksRouter.get(
  '/summary',
  asyncH((req, res) => {
    const row = db
      .prepare(
        `SELECT
           COUNT(*)                                                   AS open,
           SUM(CASE WHEN seen_at IS NULL THEN 1 ELSE 0 END)           AS unseen,
           SUM(CASE WHEN due_at IS NOT NULL AND due_at < datetime('now')
                    THEN 1 ELSE 0 END)                                AS overdue,
           SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END)         AS high
         FROM tasks
        WHERE assignee_id = ? AND status <> 'done'`
      )
      .get(req.user.sub);

    // Việc mình giao cho người khác mà quá hạn chưa xong — người giao cũng cần
    // biết, nếu không thì giao xong là rơi vào im lặng.
    const chased = db
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks
          WHERE assigner_id = ? AND status <> 'done'
            AND due_at IS NOT NULL AND due_at < datetime('now')`
      )
      .get(req.user.sub);

    res.json({
      open: row.open || 0,
      unseen: row.unseen || 0,
      overdue: row.overdue || 0,
      high: row.high || 0,
      assignedOverdue: chased.n || 0,
      canAssign: canAssignAtAll(req.user.role),
    });
  })
);

// GET /api/tasks?scope=mine|assigned|all&status=open|done|all
// mine     = việc giao cho tôi
// assigned = việc tôi giao cho người khác
// all      = mọi việc (chỉ admin; vai khác gọi thì tự hạ xuống 'mine')
tasksRouter.get(
  '/',
  asyncH((req, res) => {
    const wantAll = req.query.scope === 'all' && req.user.role === 'admin';
    const scope = wantAll ? 'all' : req.query.scope === 'assigned' ? 'assigned' : 'mine';
    const status = req.query.status || 'open';

    const where = [];
    const args = [];
    if (scope === 'mine') { where.push('t.assignee_id = ?'); args.push(req.user.sub); }
    if (scope === 'assigned') { where.push('t.assigner_id = ?'); args.push(req.user.sub); }
    if (status === 'open') where.push(`t.status <> 'done'`);
    if (status === 'done') where.push(`t.status = 'done'`);

    const rows = db
      .prepare(
        `${SELECT_TASK}
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY
           t.status = 'done',
           -- quá hạn lên đầu, rồi tới việc có hạn, cuối cùng là việc không hạn
           CASE WHEN t.status <> 'done' AND t.due_at IS NOT NULL
                     AND t.due_at < datetime('now') THEN 0 ELSE 1 END,
           CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
           t.due_at IS NULL, t.due_at ASC,
           t.id DESC
         LIMIT 300`
      )
      .all(...args)
      .map(publicTask);

    res.json(rows);
  })
);

// GET /api/tasks/assignable -> những người TÔI được phép giao việc
// Đây là lý do endpoint này tồn tại: /api/users là adminOnly, nên kĩ thuật
// không có cách nào lấy danh sách người xem để chọn.
tasksRouter.get(
  '/assignable',
  asyncH((req, res) => {
    if (!canAssignAtAll(req.user.role)) return res.json([]);
    const rows = db
      .prepare(`SELECT id, username, full_name, role FROM users WHERE active = 1 ORDER BY role, username`)
      .all()
      .filter((u) => canAssignTo(req.user.role, u.role))
      .map((u) => ({ id: u.id, username: u.username, fullName: u.full_name, role: u.role }));
    res.json(rows);
  })
);

tasksRouter.get(
  '/:id',
  asyncH((req, res) => {
    const task = getTask(Number(req.params.id));
    if (!task) return res.status(404).json({ error: 'Không tìm thấy công việc' });
    if (!mayTouch(task, req.user)) return res.status(403).json({ error: 'Không có quyền xem việc này' });
    res.json(publicTask(task));
  })
);

// --- Ghi ---------------------------------------------------------------------

// POST /api/tasks  { title, body, assigneeId, priority, dueAt }
tasksRouter.post(
  '/',
  asyncH((req, res) => {
    const { title, body = '', assigneeId, priority = 'normal', dueAt = null } = req.body || {};

    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) return res.status(400).json({ error: 'Nhập tên công việc' });
    if (cleanTitle.length > 200) return res.status(400).json({ error: 'Tên công việc quá dài (tối đa 200 ký tự)' });
    if (!PRIORITIES.includes(priority))
      return res.status(400).json({ error: `priority phải là ${PRIORITIES.join(', ')}` });

    const assignee = db.prepare(`SELECT * FROM users WHERE id = ?`).get(Number(assigneeId));
    if (!assignee) return res.status(400).json({ error: 'Không tìm thấy người nhận' });
    if (!assignee.active) return res.status(400).json({ error: 'Tài khoản người nhận đang bị khóa' });

    // Kiểm tra lại ở đây chứ không tin vào việc giao diện đã ẩn nút: giao diện
    // chỉ ngăn được người dùng bình thường, không ngăn được ai gọi thẳng API.
    if (!canAssignTo(req.user.role, assignee.role))
      return res.status(403).json({ error: 'Bạn không được giao việc cho vai trò này' });

    const info = db
      .prepare(
        `INSERT INTO tasks (title, body, assignee_id, assigner_id, priority, due_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(cleanTitle, String(body || '').trim(), assignee.id, req.user.sub, priority, dueAt || null);

    ping();
    res.status(201).json(publicTask(getTask(info.lastInsertRowid)));
  })
);

// PATCH /api/tasks/:id  { status, resultNote, title, body, priority, dueAt }
//
// Hai vai khác nhau sửa hai thứ khác nhau:
//   - người NHẬN đổi được tiến độ và ghi chú kết quả (việc của họ)
//   - người GIAO sửa được nội dung, mức ưu tiên, hạn (việc họ đặt ra)
// Người nhận sửa được đề bài của chính mình thì việc giao hết ý nghĩa.
tasksRouter.patch(
  '/:id',
  asyncH((req, res) => {
    const task = getTask(Number(req.params.id));
    if (!task) return res.status(404).json({ error: 'Không tìm thấy công việc' });
    if (!mayTouch(task, req.user)) return res.status(403).json({ error: 'Không có quyền sửa việc này' });

    const isAssignee = task.assignee_id === req.user.sub;
    const isOwner = task.assigner_id === req.user.sub || req.user.role === 'admin';
    const { status, resultNote, title, body, priority, dueAt } = req.body || {};

    const sets = [];
    const args = [];

    if (status !== undefined) {
      if (!STATUSES.includes(status))
        return res.status(400).json({ error: `status phải là ${STATUSES.join(', ')}` });
      if (!isAssignee && !isOwner)
        return res.status(403).json({ error: 'Chỉ người nhận việc mới đổi được tiến độ' });
      sets.push('status = ?'); args.push(status);
      // done_at đặt lúc chuyển sang xong và XÓA khi mở lại — nếu không, một việc
      // mở lại vẫn mang ngày hoàn thành cũ và báo cáo sẽ đếm sai.
      sets.push('done_at = ?'); args.push(status === 'done' ? nowIso() : null);
    }

    if (resultNote !== undefined) {
      if (!isAssignee && !isOwner)
        return res.status(403).json({ error: 'Không có quyền ghi kết quả' });
      sets.push('result_note = ?'); args.push(String(resultNote || '').trim());
    }

    for (const [field, col, val] of [
      ['title', 'title', title],
      ['body', 'body', body],
      ['priority', 'priority', priority],
      ['dueAt', 'due_at', dueAt],
    ]) {
      if (val === undefined) continue;
      if (!isOwner) return res.status(403).json({ error: 'Chỉ người giao việc mới sửa được nội dung' });
      if (field === 'priority' && !PRIORITIES.includes(val))
        return res.status(400).json({ error: `priority phải là ${PRIORITIES.join(', ')}` });
      if (field === 'title' && !String(val).trim())
        return res.status(400).json({ error: 'Tên công việc không được để trống' });
      sets.push(`${col} = ?`);
      args.push(field === 'dueAt' ? val || null : String(val).trim());
    }

    if (!sets.length) return res.status(400).json({ error: 'Không có gì để cập nhật' });

    sets.push(`updated_at = datetime('now')`);
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...args, task.id);

    ping();
    res.json(publicTask(getTask(task.id)));
  })
);

// POST /api/tasks/:id/seen — người nhận đã mở ra xem
// Tách khỏi PATCH vì nó không phải hành động của người dùng mà là hệ quả của
// việc mở trang; gộp vào PATCH thì mỗi lần xem lại ghi đè updated_at.
tasksRouter.post(
  '/:id/seen',
  asyncH((req, res) => {
    const task = getTask(Number(req.params.id));
    if (!task) return res.status(404).json({ error: 'Không tìm thấy công việc' });
    if (task.assignee_id !== req.user.sub)
      return res.status(403).json({ error: 'Chỉ người nhận mới đánh dấu đã xem' });
    // Chỉ ghi lần đầu: seen_at là "lần đầu biết tới việc này", không phải "lần
    // xem gần nhất".
    if (!task.seen_at) {
      db.prepare(`UPDATE tasks SET seen_at = ? WHERE id = ?`).run(nowIso(), task.id);
      ping();
    }
    res.json(publicTask(getTask(task.id)));
  })
);

// DELETE /api/tasks/:id — người giao hoặc admin
tasksRouter.delete(
  '/:id',
  asyncH((req, res) => {
    const task = getTask(Number(req.params.id));
    if (!task) return res.status(404).json({ error: 'Không tìm thấy công việc' });
    if (task.assigner_id !== req.user.sub && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Chỉ người giao việc mới xóa được' });
    db.prepare(`DELETE FROM tasks WHERE id = ?`).run(task.id);
    ping();
    res.json({ ok: true });
  })
);
