import { useEffect, useState } from 'react';
import { PageShell } from '../components/PageShell.jsx';
import { api, tokenStore } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { socket } from '../socket.js';
import { IconLock } from '../components/Icons.jsx';
import './ChangePassword.css';

const MIN_LENGTH = 6;
const EMPTY = { current: '', next: '', confirm: '' };

// Returns the first problem with the form, or null when it is safe to submit.
// Kept out of the component so the ordering of the rules is easy to read: the
// user should be told about a missing field before a length or match problem.
function validate({ current, next, confirm }) {
  if (!current || !next || !confirm) return 'Vui lòng nhập đầy đủ cả ba ô mật khẩu.';
  if (next.length < MIN_LENGTH) return `Mật khẩu mới phải có ít nhất ${MIN_LENGTH} ký tự.`;
  if (next !== confirm) return 'Mật khẩu nhập lại không khớp với mật khẩu mới.';
  if (next === current) return 'Mật khẩu mới phải khác mật khẩu hiện tại.';
  return null;
}

export function ChangePassword() {
  const { user } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState(null); // { text, ok }
  const [busy, setBusy] = useState(false);

  // The shell's link lamp is on this page too. Report the real socket rather
  // than letting it default to a state this page never verified.
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    // Re-read after subscribing: the handshake can land between the seeding
    // render and this effect, and a missed 'connect' latches the lamp DOWN.
    setConnected(socket.connected);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  // Editing any field clears a stale result so the message always refers to
  // the values currently on screen.
  const set = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
    setMsg(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;

    const problem = validate(form);
    if (problem) {
      setMsg({ text: problem, ok: false });
      return;
    }

    setBusy(true);
    try {
      // Đổi mật khẩu khai tử MỌI token đã phát cho tài khoản này — kể cả cái
      // đang dùng để gửi chính lời gọi vừa rồi. Backend trả lại một token mới;
      // không thay vào đây thì thao tác kế tiếp ăn 401 và người dùng bị đá ra
      // ngay sau khi đổi mật khẩu thành công.
      const res = await api.changePassword(form.current, form.next);
      if (res?.token) tokenStore.set(res.token);
      setForm(EMPTY);
      setMsg({
        text: 'Đổi mật khẩu thành công. Các thiết bị khác đang đăng nhập sẽ phải đăng nhập lại.',
        ok: true,
      });
    } catch (err) {
      setMsg({ text: err.message || 'Đổi mật khẩu thất bại. Vui lòng thử lại.', ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell title="ĐỔI MẬT KHẨU" onBack="/menu" connected={connected}>
      <form className="cpw-card" onSubmit={submit} noValidate>
        <div className="cpw-head">
          <span className="cpw-head-icon">
            <IconLock size={28} />
          </span>
          <span className="cpw-head-text">
            <strong className="cpw-head-title">Mật khẩu tài khoản</strong>
            <span className="cpw-head-sub">Tối thiểu {MIN_LENGTH} ký tự</span>
          </span>
        </div>

        {/* A password form with no username field leaves a password manager
            guessing which account it just updated — on a shared panel that is
            how the wrong credential gets saved. Hidden, never submitted. */}
        <input
          type="text"
          name="username"
          value={user?.username || ''}
          autoComplete="username"
          readOnly
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={() => {}}
        />

        <label className="field cpw-field">
          Mật khẩu hiện tại
          <input
            type="password"
            value={form.current}
            onChange={set('current')}
            autoComplete="current-password"
            disabled={busy}
          />
        </label>

        <label className="field cpw-field">
          Mật khẩu mới
          <input
            type="password"
            value={form.next}
            onChange={set('next')}
            autoComplete="new-password"
            disabled={busy}
          />
        </label>

        <label className="field cpw-field">
          Nhập lại mật khẩu mới
          <input
            type="password"
            value={form.confirm}
            onChange={set('confirm')}
            autoComplete="new-password"
            disabled={busy}
          />
        </label>

        {/* One message area for both outcomes; aria-live so it is announced. */}
        <div className="cpw-msg-slot" role="status" aria-live="polite">
          {msg && (
            <p className={`form-msg cpw-msg ${msg.ok ? 'cpw-msg-ok' : 'error'}`}>{msg.text}</p>
          )}
        </div>

        <button type="submit" className="primary-btn cpw-submit" disabled={busy}>
          {busy ? 'Đang đổi mật khẩu…' : 'Đổi mật khẩu'}
        </button>
      </form>
    </PageShell>
  );
}

export default ChangePassword;
