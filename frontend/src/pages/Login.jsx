import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import logoUrl from '../assets/logo.jpg';

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message || 'Đăng nhập thất bại');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        {/* No emoji anywhere in this design; the login card wears the same
            brand block PageShell puts on every screen behind it. */}
        {/* Logo chính thức thay cho hai dòng chữ dựng bằng CSS — cùng một ảnh
            với thanh tiêu đề trong PageShell, để không có hai phiên bản nhận
            diện lệch nhau. */}
        <img
          className="login-logo"
          src={logoUrl}
          alt="FPT Education — FPT Polytechnic"
          width="1260"
          height="428"
        />
        <div className="login-brand">SMART FARM</div>
        <p className="login-sub">Hệ thống nông nghiệp thông minh dùng LoRa</p>

        <label>Tài khoản</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="admin"
          autoFocus
        />

        <label>Mật khẩu</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••"
        />

        {error && <div className="login-error">{error}</div>}

        <button type="submit" disabled={busy}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>

      </form>
    </div>
  );
}
