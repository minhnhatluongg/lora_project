import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import logoUrl from '../assets/logo.jpg';

// Nền là một đoạn phim máy cày ngoài đồng, phát vòng lặp không tiếng.
//
// Đặt ở CloudFront và nặng khoảng 10 MB, nên nó KHÔNG được phép là điều kiện
// để đăng nhập: bảng điều khiển có thể nằm trong nhà kính chỉ có mạng nội bộ.
// Phía sau video luôn có một nền chuyển sắc màu đồng ruộng, nên video tải chậm,
// bị chặn, hay trình duyệt từ chối tự phát thì màn hình vẫn ra dáng cố ý chứ
// không phải một mảng đen hỏng.
const BG_VIDEO =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260622_204103_f607742e-09da-4cf5-bb06-4e67b0a531de.mp4';

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
      {/* aria-hidden + tabIndex -1: đây là trang trí, trình đọc màn hình và
          phím Tab không có việc gì với nó. */}
      <video
        className="login-video"
        src={BG_VIDEO}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
      />
      {/* Lớp phủ tối: chữ trắng trên video sáng tối thất thường thì không đọc
          nổi, và độ sáng thay đổi theo từng khung hình. */}
      <div className="login-scrim" aria-hidden="true" />

      <form className="login-card" onSubmit={submit}>
        <img
          className="login-logo"
          src={logoUrl}
          alt="FPT Education — FPT Polytechnic"
          width="1260"
          height="428"
        />
        <div className="login-brand">SMART FARM</div>
        <p className="login-sub">Hệ thống nông nghiệp thông minh dùng LoRa</p>

        <label htmlFor="login-user">Tài khoản</label>
        <input
          id="login-user"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Tài khoản"
          autoComplete="username"
          autoFocus
        />

        <label htmlFor="login-pass">Mật khẩu</label>
        <input
          id="login-pass"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••"
          autoComplete="current-password"
        />

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <button type="submit" disabled={busy}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  );
}
