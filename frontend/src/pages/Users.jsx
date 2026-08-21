import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { PageShell } from '../components/PageShell.jsx';
import { useAuth, ROLE_LABEL } from '../auth/AuthContext.jsx';
import { socket } from '../socket.js';
import {
  IconUsers,
  IconUserPlus,
  IconKey,
  IconTrash,
  IconLock,
  IconUnlock,
  IconWarning,
  IconCheck,
} from '../components/Icons.jsx';
import './Users.css';

const ROLES = ['admin', 'technician', 'viewer'];
const EMPTY = { username: '', password: '', fullName: '', role: 'viewer' };
const MIN_PASSWORD = 6;

// Mỗi vai một sắc, dùng lại cho cả huy hiệu vai trò lẫn viền ảnh đại diện. Nhưng
// sắc chỉ là lớp nhấn — tên vai luôn viết ra bằng chữ ngay cạnh.
const ROLE_TONE = { admin: 'usr-tone-admin', technician: 'usr-tone-tech', viewer: 'usr-tone-viewer' };

// Chữ cái đầu của họ và tên, tối đa hai ký tự. Không có họ tên thì lấy tên đăng
// nhập, để ô đại diện không bao giờ trống.
function initials(user) {
  const src = (user.fullName || user.username || '').trim();
  if (!src) return '?';
  const parts = src.split(/\s+/);
  const take = parts.length >= 2 ? [parts[0], parts[parts.length - 1]] : [parts[0]];
  return take.map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  // { kind: 'ok' | 'err', text }
  const [msg, setMsg] = useState(null);
  // Hộp thoại đang mở: { type: 'delete' | 'password', user }
  const [dialog, setDialog] = useState(null);

  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    // Đọc lại SAU khi đăng ký: cái bắt tay có thể xong giữa lần vẽ đầu và effect
    // này, bỏ lỡ 'connect' là đèn báo kẹt ở trạng thái mất kết nối.
    setConnected(socket.connected);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const ok = (text) => setMsg({ kind: 'ok', text });
  const fail = (e) => setMsg({ kind: 'err', text: e.message || 'Đã xảy ra lỗi' });

  const load = () => api.users().then(setUsers).catch(fail);
  useEffect(() => { load(); }, []);

  // Backend từ chối hạ cấp / khóa / xóa người quản trị CUỐI CÙNG. Đếm luôn ở đây
  // để nút hiện ra đã mờ sẵn kèm lý do, thay vì bấm xong mới ăn thông báo lỗi.
  const lastAdmin = useMemo(
    () => users.filter((u) => u.role === 'admin' && u.active).length <= 1,
    [users]
  );

  const create = async (e) => {
    e.preventDefault();
    if (busy) return;
    setMsg(null);
    if (!form.username.trim()) return fail(new Error('Nhập tên đăng nhập.'));
    if (form.password.length < MIN_PASSWORD)
      return fail(new Error(`Mật khẩu phải có ít nhất ${MIN_PASSWORD} ký tự.`));

    setBusy(true);
    try {
      await api.createUser({ ...form, username: form.username.trim() });
      setForm(EMPTY);
      ok(`Đã tạo tài khoản "${form.username.trim()}".`);
      load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (u, body, done) => {
    setMsg(null);
    try {
      await api.updateUser(u.id, body);
      if (done) ok(done);
      load();
    } catch (e) {
      fail(e);
    }
  };

  const remove = async (u) => {
    setMsg(null);
    try {
      await api.deleteUser(u.id);
      ok(`Đã xóa tài khoản "${u.username}".`);
      setDialog(null);
      load();
    } catch (e) {
      fail(e);
      setDialog(null);
    }
  };

  const setField = (k) => (e) => {
    setForm((prev) => ({ ...prev, [k]: e.target.value }));
    setMsg(null);
  };

  return (
    <PageShell title="USERS" onBack="/menu" connected={connected}>
      <div className="usr-page">
        {msg && (
          <p className={`usr-msg${msg.kind === 'err' ? ' is-bad' : ' is-ok'}`} role="status">
            {msg.kind === 'err' ? <IconWarning size={17} /> : <IconCheck size={17} />}
            {msg.text}
          </p>
        )}

        {/* ---- Cấp tài khoản ---- */}
        <section className="usr-panel">
          <header className="usr-head">
            <span className="usr-head-icon"><IconUserPlus size={22} /></span>
            <h2>CẤP TÀI KHOẢN MỚI</h2>
          </header>

          <form className="usr-form" onSubmit={create}>
            <label className="usr-field">
              <span>Tên đăng nhập</span>
              <input
                value={form.username}
                onChange={setField('username')}
                placeholder="vd: kythuat2"
                autoComplete="username"
                required
              />
            </label>

            <label className="usr-field">
              <span>Họ tên</span>
              <input
                value={form.fullName}
                onChange={setField('fullName')}
                placeholder="vd: Nguyễn Văn A"
                autoComplete="name"
              />
            </label>

            <label className="usr-field">
              <span>Mật khẩu <em>(tối thiểu {MIN_PASSWORD} ký tự)</em></span>
              <input
                type="password"
                value={form.password}
                onChange={setField('password')}
                placeholder="••••••"
                autoComplete="new-password"
                required
              />
            </label>

            <label className="usr-field">
              <span>Vai trò</span>
              <select value={form.role} onChange={setField('role')}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </label>

            <div className="usr-form-foot">
              <button type="submit" className="usr-btn usr-btn-primary" disabled={busy}>
                <IconUserPlus size={17} />
                {busy ? 'Đang tạo…' : 'Tạo tài khoản'}
              </button>
              {/* Nói trước quyền của từng vai, thay vì để người quản trị đoán
                  qua tên gọi rồi cấp nhầm. */}
              <p className="usr-hint">
                <strong>Quản trị</strong> toàn quyền · <strong>Kỹ thuật</strong> điều khiển và cài
                đặt · <strong>Người xem</strong> chỉ xem và nhận việc
              </p>
            </div>
          </form>
        </section>

        {/* ---- Danh sách ---- */}
        <section className="usr-panel">
          <header className="usr-head">
            <span className="usr-head-icon"><IconUsers size={22} /></span>
            <h2>DANH SÁCH TÀI KHOẢN</h2>
            <span className="usr-count">{users.length} tài khoản</span>
          </header>

          {/* table-cards: ở bề ngang điện thoại mỗi hàng gập thành một thẻ
              (styles.css). data-label là nhãn cột đi kèm từng ô vì hàng tiêu đề
              bị ẩn đi. */}
          <div className="table-wrap table-cards usr-table">
            <table>
              <thead>
                <tr>
                  <th>Tài khoản</th>
                  <th>Vai trò</th>
                  <th>Trạng thái</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isMe = u.id === me?.id;
                  const protectedAdmin = u.role === 'admin' && u.active && lastAdmin;
                  return (
                    <tr key={u.id} className={u.active ? '' : 'usr-row-off'}>
                      <td>
                        <span className="usr-who">
                          <span className={`usr-avatar ${ROLE_TONE[u.role] || ''}`} aria-hidden="true">
                            {initials(u)}
                          </span>
                          <span className="usr-who-text">
                            <strong>
                              {u.username}
                              {isMe && <span className="usr-you">bạn</span>}
                            </strong>
                            <em>{u.fullName || 'Chưa đặt họ tên'}</em>
                          </span>
                        </span>
                      </td>

                      <td data-label="Vai trò">
                        <select
                          className={`usr-role ${ROLE_TONE[u.role] || ''}`}
                          value={u.role}
                          aria-label={`Vai trò của ${u.username}`}
                          disabled={protectedAdmin}
                          title={protectedAdmin ? 'Không thể hạ cấp người quản trị cuối cùng' : undefined}
                          onChange={(e) => patch(u, { role: e.target.value }, 'Đã đổi vai trò.')}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                          ))}
                        </select>
                      </td>

                      <td data-label="Trạng thái">
                        <span className={`usr-pill ${u.active ? 'is-on' : 'is-off'}`}>
                          {u.active ? 'Hoạt động' : 'Đã khóa'}
                        </span>
                      </td>

                      <td className="row-actions usr-actions" data-label="Hành động">
                        <button
                          type="button"
                          className="usr-btn usr-btn-sm"
                          disabled={protectedAdmin}
                          title={protectedAdmin ? 'Không thể khóa người quản trị cuối cùng' : undefined}
                          onClick={() =>
                            patch(u, { active: !u.active }, u.active ? 'Đã khóa tài khoản.' : 'Đã mở khóa.')
                          }
                        >
                          {u.active ? <IconLock size={15} /> : <IconUnlock size={15} />}
                          {u.active ? 'Khóa' : 'Mở khóa'}
                        </button>

                        <button
                          type="button"
                          className="usr-btn usr-btn-sm"
                          onClick={() => setDialog({ type: 'password', user: u })}
                        >
                          <IconKey size={15} />
                          Đổi mật khẩu
                        </button>

                        <button
                          type="button"
                          className="usr-btn usr-btn-sm usr-btn-danger"
                          disabled={isMe || protectedAdmin}
                          title={
                            isMe
                              ? 'Không thể tự xóa chính mình'
                              : protectedAdmin
                                ? 'Không thể xóa người quản trị cuối cùng'
                                : undefined
                          }
                          onClick={() => setDialog({ type: 'delete', user: u })}
                        >
                          <IconTrash size={15} />
                          Xóa
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {users.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">Đang tải danh sách…</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {dialog && (
        <UserDialog
          dialog={dialog}
          onClose={() => setDialog(null)}
          onDelete={remove}
          onPassword={async (pw) => {
            await patch(dialog.user, { password: pw }, `Đã đổi mật khẩu cho "${dialog.user.username}".`);
            setDialog(null);
          }}
        />
      )}
    </PageShell>
  );
}

// Thay cho prompt() và confirm() của trình duyệt. Không phải để cho đẹp:
// prompt() hiện mật khẩu ra dạng chữ thường, không nhập lại được lần hai để đối
// chiếu, và không kiểm được độ dài — gõ nhầm một ký tự là khóa người ta ra ngoài
// mà chẳng ai biết. Hộp thoại này che cả hai lỗ hổng đó.
function UserDialog({ dialog, onClose, onDelete, onPassword }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { type, user } = dialog;

  // Esc để đóng — hộp thoại nào cũng phải thoát được bằng bàn phím.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submitPassword = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (pw.length < MIN_PASSWORD) return setErr(`Mật khẩu phải có ít nhất ${MIN_PASSWORD} ký tự.`);
    if (pw !== pw2) return setErr('Hai ô mật khẩu không khớp.');
    setBusy(true);
    try {
      await onPassword(pw);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="usr-modal"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="usr-dialog-title"
    >
      <div className="usr-dialog">
        {type === 'delete' ? (
          <>
            <h3 id="usr-dialog-title" className="usr-dialog-title is-bad">
              <IconTrash size={19} />
              Xóa tài khoản
            </h3>
            <p className="usr-dialog-text">
              Xóa <strong>{user.username}</strong>
              {user.fullName ? ` (${user.fullName})` : ''}? Mọi công việc đã giao cho người này
              cũng bị xóa theo và không lấy lại được.
            </p>
            <div className="usr-dialog-actions">
              <button type="button" className="usr-btn" onClick={onClose}>Huỷ</button>
              <button
                type="button"
                className="usr-btn usr-btn-danger-solid"
                onClick={() => onDelete(user)}
              >
                <IconTrash size={16} />
                Xóa tài khoản
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submitPassword}>
            <h3 id="usr-dialog-title" className="usr-dialog-title">
              <IconKey size={19} />
              Đổi mật khẩu
            </h3>
            <p className="usr-dialog-text">
              Đặt mật khẩu mới cho <strong>{user.username}</strong>. Người dùng sẽ đăng nhập bằng
              mật khẩu này ở lần sau.
            </p>

            <label className="usr-field">
              <span>Mật khẩu mới</span>
              <input
                type="password"
                value={pw}
                autoFocus
                onChange={(e) => { setPw(e.target.value); setErr(''); }}
                autoComplete="new-password"
              />
            </label>
            <label className="usr-field">
              <span>Nhập lại</span>
              <input
                type="password"
                value={pw2}
                onChange={(e) => { setPw2(e.target.value); setErr(''); }}
                autoComplete="new-password"
              />
            </label>

            {err && (
              <p className="usr-msg is-bad" role="alert">
                <IconWarning size={15} />
                {err}
              </p>
            )}

            <div className="usr-dialog-actions">
              <button type="button" className="usr-btn" onClick={onClose}>Huỷ</button>
              <button type="submit" className="usr-btn usr-btn-primary" disabled={busy}>
                <IconKey size={16} />
                {busy ? 'Đang lưu…' : 'Đổi mật khẩu'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default Users;
