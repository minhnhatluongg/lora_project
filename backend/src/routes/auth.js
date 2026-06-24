import { Router } from 'express';
import { db } from '../db.js';
import { asyncH } from '../middleware.js';
import { requireAuth, verifyPassword, signToken } from '../auth.js';

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
