import { Router } from 'express';
import { db } from '../db.js';
import { asyncH } from '../middleware.js';
import {
  requireAuth,
  verifyPassword,
  hashPassword,
  signToken,
  revokeSessions,
} from '../auth.js';

// Short enough for a gloved hand on a touch panel, long enough to be worth
// asking for. Mirrored in the frontend's Account screen.
const MIN_PASSWORD_LENGTH = 6;

export const authRouter = Router();

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  fullName: u.full_name,
  role: u.role,
});

// POST /api/auth/login  { username, password } -> { token, user }
authRouter.post(
  '/login',
  asyncH((req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: 'username & password required' });

    const user = db
      .prepare(`SELECT * FROM users WHERE username = ? AND active = 1`)
      .get(username);
    if (!user || !verifyPassword(password, user.password_hash))
      return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });

    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

// GET /api/auth/me -> current user (validates token)
authRouter.get(
  '/me',
  requireAuth,
  asyncH((req, res) => {
    const user = db
      .prepare(`SELECT * FROM users WHERE id = ?`)
      .get(req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(publicUser(user));
  })
);

// POST /api/auth/change-password  { currentPassword, newPassword }
// Any logged-in role may change their OWN password (admins reset other people's
// through PATCH /api/users/:id). Nothing here is ever logged — not the body,
// not the hash — because the request log middleware only prints method + url.
authRouter.post(
  '/change-password',
  requireAuth,
  asyncH((req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword)
      return res
        .status(400)
        .json({ error: 'Cần nhập mật khẩu hiện tại và mật khẩu mới' });
    if (String(newPassword).length < MIN_PASSWORD_LENGTH)
      return res
        .status(400)
        .json({ error: `Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự` });

    const user = db
      .prepare(`SELECT * FROM users WHERE id = ? AND active = 1`)
      .get(req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // 401, not 403: the caller's identity is fine, they just failed to prove it
    // a second time. Same wording as login so we don't leak anything extra.
    if (!verifyPassword(currentPassword, user.password_hash))
      return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });

    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
      hashPassword(newPassword),
      user.id
    );

    // Đổi mật khẩu là cách duy nhất người dùng tự cắt được một token bị lộ:
    // JWT không trạng thái nên "Đăng xuất" chỉ xoá bản sao trong trình duyệt
    // này, còn bản bị đánh cắp vẫn chạy tới khi hết hạn. Dấu mốc dưới đây khai
    // tử MỌI token đã phát trước thời điểm này.
    const cutoff = revokeSessions(user.id);

    // ...kể cả token người dùng đang cầm — nên phát ngay một cái mới, nếu không
    // họ vừa đổi mật khẩu xong là bị chính hệ thống đá ra. Frontend thay token
    // cũ bằng token này (ChangePassword.jsx).
    //
    // `cutoff + 1` không phải mẹo vặt: requireAuth từ chối mọi token có
    // iat <= mốc thu hồi, mà token phát ngay lúc này thường trúng đúng giây đó.
    // Đẩy mốc phát hành lên một giây để nó nằm hẳn về phía sau lằn ranh.
    const fresh = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
    res.json({ ok: true, token: signToken(fresh, cutoff + 1) });
  })
);
