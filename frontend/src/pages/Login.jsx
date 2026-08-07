import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';

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
        <div className="login-org">
          <span className="login-org-main">FPT Education</span>
          <span className="login-org-sub">FPT POLYTECHNIC</span>
        </div>
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

        <p className="login-hint">Mặc định: admin / admin123</p>
      </form>
    </div>
  );
}
