import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';

export const ROLES = ['admin', 'technician', 'viewer'];

export const hashPassword = (plain) => bcrypt.hashSync(plain, 10);
export const verifyPassword = (plain, hash) => bcrypt.compareSync(plain, hash);

// `issuedAt` (giây Unix) để ép mốc phát hành thay vì lấy đồng hồ hiện tại. Chỉ
// dùng ở một chỗ: phát token thay thế ngay sau khi thu hồi — xem giải thích ở
// revokeSessions. Bỏ trống thì jsonwebtoken tự lấy giờ hiện tại như thường.
export function signToken(user, issuedAt) {
  const payload = { sub: user.id, username: user.username, role: user.role };
  if (issuedAt) payload.iat = issuedAt;
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

// Đổi chuỗi thời gian của SQLite (UTC, không hậu tố) sang giây Unix để so với
// `iat` trong JWT. Thiếu chữ 'Z' là JavaScript hiểu thành giờ máy — lệch đúng
// bằng múi giờ, tức 7 tiếng ở Việt Nam, và mốc thu hồi sẽ sai hẳn.
const toEpoch = (sqlish) =>
  Math.floor(new Date(sqlish.replace(' ', 'T') + 'Z').getTime() / 1000);

// Đổi mốc thu hồi của một tài khoản sang "bây giờ": mọi token đã phát ra trước
// thời điểm này lập tức hết hiệu lực. Dùng khi đổi mật khẩu — kể cả admin đặt
// lại hộ người khác. Trả về mốc đã ghi, tính bằng giây Unix.
export function revokeSessions(userId) {
  db.prepare(`UPDATE users SET token_valid_after = datetime('now') WHERE id = ?`).run(userId);
  const row = db.prepare(`SELECT token_valid_after FROM users WHERE id = ?`).get(userId);
  return toEpoch(row.token_valid_after);
}

// Verifies the Bearer JWT and attaches req.user. Any logged-in role passes.
//
// Chữ ký hợp lệ CHƯA ĐỦ. JWT là ảnh chụp lúc đăng nhập, còn tài khoản thì đổi
// sau đó: có thể bị khóa, bị xóa, bị hạ vai trò, hoặc đổi mật khẩu. Nên mỗi lời
// gọi đều đối chiếu lại với CSDL. Đó là một lần tra theo khóa chính trên SQLite
// nội bộ — vài micro-giây, đổi lại là khóa tài khoản có tác dụng NGAY thay vì
// phải chờ token hết hạn.
export function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const row = db
    .prepare(`SELECT id, username, role, active, token_valid_after FROM users WHERE id = ?`)
    .get(claims.sub);

  if (!row) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });
  if (!row.active) return res.status(401).json({ error: 'Tài khoản đã bị khóa' });

  // `<=` chứ không phải `<`. `iat` chỉ có độ phân giải một giây, nên một token
  // phát ra CÙNG GIÂY với lúc thu hồi là trường hợp nhập nhằng — không có cách
  // nào biết nó ra trước hay sau. Chọn phía an toàn: giết nó. (Bộ thử bắt được
  // đúng chỗ này: nó chạy nhanh hơn một giây nên token cũ lọt qua với phép `<`.)
  //
  // Đổi lại, token thay thế phát ngay sau khi thu hồi cũng sẽ trúng cùng giây và
  // chết theo — nên nó được phát với iat = mốc + 1, xem signToken.
  if (row.token_valid_after && claims.iat <= toEpoch(row.token_valid_after)) {
    return res.status(401).json({ error: 'Phiên đã hết hiệu lực, vui lòng đăng nhập lại' });
  }

  // Vai trò lấy từ CSDL, KHÔNG lấy từ token. Vai trò được nhúng vào JWT lúc
  // đăng nhập, nên hạ cấp một người từ kỹ thuật xuống người xem mà vẫn tin
  // token thì họ giữ nguyên quyền cũ tới hết hạn — một khoảng leo thang đặc
  // quyền dài hàng giờ. Đọc lại từ CSDL thì lần gọi kế tiếp đã đúng vai, và
  // người đó không phải đăng nhập lại.
  req.user = { ...claims, role: row.role, username: row.username };
  next();
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

// --- Trật tự phân việc -------------------------------------------------------
// Ba vai trò trước nay chỉ dùng để chặn quyền bấm nút; với bảng `tasks` chúng
// còn là một trật tự trên dưới: giao được việc cho bất kỳ ai xếp THẤP HƠN mình.
// Admin giao cho kĩ thuật và người xem, kĩ thuật giao cho người xem, người xem
// không giao cho ai.
//
// So sánh bằng thứ hạng chứ không liệt kê từng cặp: thêm một vai trò sau này
// chỉ cần thêm một dòng ở đây, không phải đi sửa mọi chỗ kiểm tra.
export const ROLE_RANK = { admin: 3, technician: 2, viewer: 1 };

export const canAssignTo = (actorRole, targetRole) =>
  (ROLE_RANK[actorRole] || 0) > (ROLE_RANK[targetRole] || 0);

// Vai trò có thể được giao việc cho người khác — dùng để ẩn/hiện nút "Giao
// việc". Luật thật vẫn là canAssignTo ở trên, kiểm lại lần nữa lúc ghi.
export const canAssignAtAll = (role) => (ROLE_RANK[role] || 0) > 1;
