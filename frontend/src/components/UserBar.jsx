import { Link } from 'react-router-dom';
import { useAuth, can, ROLE_LABEL } from '../auth/AuthContext.jsx';
import { IconLogout, IconUsers, IconTasks } from './Icons.jsx';
import { useTaskBadge } from '../tasks/TaskBadgeContext.jsx';
import './UserBar.css';

// The panel design has no sidebar and no top bar — MENU is where an operator
// signs out. This is the one piece of chrome that survives from the old shell:
// a quiet line above the page telling you WHO is logged in (a shared touch panel
// makes that non-obvious) with a logout escape hatch on every screen, not just
// on MENU. It is deliberately small and low-contrast so it reads as chrome and
// never competes with PageShell's brand band underneath it.
export function UserBar() {
  const { user, logout } = useAuth();
  const { summary } = useTaskBadge();
  if (!user) return null;

  return (
    <div className="userbar">
      <span className="userbar-name">{user.fullName || user.username}</span>
      <span className="userbar-role">{ROLE_LABEL[user.role] || user.role}</span>
      {/* Việc chưa xong, theo người dùng suốt mọi trang. Ô ở MENU chỉ thấy được
          khi đang đứng ở MENU; một người đang thao tác ở CONTROL cả buổi thì
          không có gì báo cho họ biết vừa bị giao việc. Chỉ hiện khi có việc —
          một con số 0 thường trực thì chẳng ai còn để mắt tới nó nữa. */}
      {summary.open > 0 && (
        <Link
          className={`userbar-tasks${summary.overdue > 0 ? ' is-overdue' : ''}`}
          to="/tasks"
          title={
            summary.overdue > 0
              ? `${summary.open} việc chưa xong, ${summary.overdue} việc đã quá hạn`
              : `${summary.open} việc chưa xong`
          }
        >
          <IconTasks size={15} />
          <span className="userbar-tasks-n">{summary.open > 99 ? '99+' : summary.open}</span>
          <span className="pageshell-sr">
            {' '}việc chưa xong{summary.overdue > 0 ? `, ${summary.overdue} việc quá hạn` : ''}
          </span>
        </Link>
      )}

      {/* The MENU grid reproduces the 6 cards of the panel design and has no
          USERS tile, so without this the admin-only /users route would exist
          with nothing anywhere linking to it. */}
      {can.manageUsers(user.role) && (
        <Link className="userbar-link" to="/users">
          <IconUsers size={16} />
          Người dùng
        </Link>
      )}
      <button type="button" className="userbar-logout" onClick={logout}>
        <IconLogout size={16} />
        Đăng xuất
      </button>
    </div>
  );
}

export default UserBar;
