import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export const ROLES = ['admin', 'technician', 'viewer'];

export const hashPassword = (plain) => bcrypt.hashSync(plain, 10);
export const verifyPassword = (plain, hash) => bcrypt.compareSync(plain, hash);

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

// Verifies the Bearer JWT and attaches req.user. Any logged-in role passes.
export function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Restricts to specific roles. Use after requireAuth.
export function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowed.includes(req.user.role))
      return res
        .status(403)
        .json({ error: `Requires role: ${allowed.join(' or ')}` });
    next();
  };
}

// Convenience guards
export const canControl = requireRole('admin', 'technician');
export const canConfig = requireRole('admin', 'technician');
export const adminOnly = requireRole('admin');
