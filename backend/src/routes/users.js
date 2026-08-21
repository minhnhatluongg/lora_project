import { Router } from 'express';
import { db } from '../db.js';
import { asyncH } from '../middleware.js';
import { requireAuth, adminOnly, hashPassword, ROLES, revokeSessions } from '../auth.js';

export const usersRouter = Router();

// All user-management endpoints are admin-only.
usersRouter.use(requireAuth, adminOnly);

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  fullName: u.full_name,
  role: u.role,
  active: !!u.active,
  createdAt: u.created_at,
});

// GET /api/users -> list
usersRouter.get(
  '/',
  asyncH((req, res) => {
    const rows = db
      .prepare(`SELECT * FROM users ORDER BY id ASC`)
      .all()
      .map(publicUser);
    res.json(rows);
  })
);

// POST /api/users  { username, password, fullName, role }
usersRouter.post(
  '/',
  asyncH((req, res) => {
    const { username, password, fullName = '', role = 'viewer' } =
      req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: 'username & password required' });
    if (!ROLES.includes(role))
      return res.status(400).json({ error: `role must be one of ${ROLES.join(', ')}` });

    const exists = db
      .prepare(`SELECT 1 FROM users WHERE username = ?`)
      .get(username);
    if (exists) return res.status(409).json({ error: 'Tài khoản đã tồn tại' });

    const info = db
      .prepare(
        `INSERT INTO users (username, full_name, password_hash, role)
         VALUES (?, ?, ?, ?)`
      )
      .run(username, fullName, hashPassword(password), role);
    const user = db
      .prepare(`SELECT * FROM users WHERE id = ?`)
      .get(info.lastInsertRowid);
    res.status(201).json(publicUser(user));
  })
);

// PATCH /api/users/:id  { role?, active?, password?, fullName? }
usersRouter.patch(
  '/:id',
  asyncH((req, res) => {
    const id = Number(req.params.id);
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { role, active, password, fullName } = req.body || {};
    if (role !== undefined && !ROLES.includes(role))
      return res.status(400).json({ error: 'invalid role' });

    // Don't let an admin lock themselves out / demote the last admin
    if ((role && role !== 'admin') || active === false) {
      if (user.role === 'admin') {
        const admins = db
          .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`)
          .get().n;
        if (admins <= 1)
          return res
            .status(400)
            .json({ error: 'Không thể vô hiệu hóa admin cuối cùng' });
      }
    }

    const sets = [];
    const params = [];
    if (role !== undefined) { sets.push('role = ?'); params.push(role); }
    if (active !== undefined) { sets.push('active = ?'); params.push(active ? 1 : 0); }
    if (fullName !== undefined) { sets.push('full_name = ?'); params.push(fullName); }
    if (password) { sets.push('password_hash = ?'); params.push(hashPassword(password)); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    // Admin đặt lại mật khẩu hộ ai đó thì phiên đang mở của người đó phải chết
    // ngay — nếu không, việc đặt lại mật khẩu vì nghi lộ tài khoản chẳng đuổi
    // được ai ra cả.
    //
    // Khóa tài khoản (active = 0) KHÔNG cần dấu mốc: requireAuth đọc thẳng cột
    // `active` mỗi lời gọi, nên nó có tác dụng tức thì. Đổi vai trò cũng vậy —
    // vai trò lấy từ CSDL chứ không lấy từ token.
    if (password) revokeSessions(id);

    const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    res.json(publicUser(updated));
  })
);

// DELETE /api/users/:id
usersRouter.delete(
  '/:id',
  asyncH((req, res) => {
    const id = Number(req.params.id);
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (id === req.user.sub)
      return res.status(400).json({ error: 'Không thể tự xóa chính mình' });
    if (user.role === 'admin') {
      const admins = db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`)
        .get().n;
      if (admins <= 1)
        return res.status(400).json({ error: 'Không thể xóa admin cuối cùng' });
    }
    db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    res.json({ ok: true });
  })
);
