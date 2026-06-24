import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';
import { useAuth, ROLE_LABEL } from '../auth/AuthContext.jsx';

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="layout">
      <Sidebar role={user.role} />
      <main className="content">
        <header className="topbar">
          <div />
          <div className="topbar-status">
            <span className="user-chip">
              👤 {user.fullName || user.username}
              <span className="user-role">{ROLE_LABEL[user.role]}</span>
            </span>
            <button className="logout-btn" onClick={logout}>
              Đăng xuất
            </button>
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
