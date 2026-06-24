import { NavLink } from 'react-router-dom';
import { can } from '../auth/AuthContext.jsx';

export function Sidebar({ role }) {
  const items = [
    { to: '/', icon: '📊', label: 'Dashboard', end: true, show: true },
    { to: '/settings', icon: '⚙️', label: 'Cài đặt & Tự động', show: can.config(role) },
    { to: '/users', icon: '👥', label: 'Người dùng', show: can.manageUsers(role) },
  ].filter((i) => i.show);

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-logo">🌿</span>
        <span className="brand-name">SMART FARM</span>
      </div>
      <nav>
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              `nav-item ${isActive ? 'nav-active' : ''}`
            }
          >
            <span className="nav-icon">{it.icon}</span>
            {it.label}
          </NavLink>
        ))}
      </nav>
      <a
        className="nav-item docs-link"
        href="/api/docs"
        target="_blank"
        rel="noreferrer"
      >
        <span className="nav-icon">📑</span>
        API Docs (Swagger)
      </a>
    </aside>
  );
}
