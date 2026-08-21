import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth, can } from "./auth/AuthContext.jsx";
import { UserBar } from "./components/UserBar.jsx";
import { TaskBadgeProvider } from "./tasks/TaskBadgeContext.jsx";
import { Login } from "./pages/Login.jsx";
import { Menu } from "./pages/Menu.jsx";
import { Dashboard } from "./pages/Dashboard.jsx";
import { Control } from "./pages/Control.jsx";
import { Settings } from "./pages/Settings.jsx";
import { About } from "./pages/About.jsx";
import { Tasks } from "./pages/Tasks.jsx";
import { ChangePassword } from "./pages/ChangePassword.jsx";
import { Users } from "./pages/Users.jsx";

// Every screen draws its own chrome through PageShell, so the app shell is just
// the centred `.content` column the Foundation agent's stylesheet expects, plus
// the user/logout line. There is no sidebar in this design.
export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="full-center">Đang tải…</div>;

  if (!user) return <Login />;

  // A screen the role can't use is bounced to MENU rather than rendered empty:
  // the server would refuse the calls anyway, and MENU already hides the card.
  // `replace` keeps the blocked path out of history so Back doesn't ping-pong.
  const guard = (allowed, element) =>
    allowed ? element : <Navigate to="/menu" replace />;

  // Provider bọc cả UserBar lẫn các trang: huy hiệu ở thanh tài khoản và huy
  // hiệu trên ô MENU phải đọc cùng một con số, chứ không phải mỗi nơi tự hỏi
  // server rồi có lúc lệch nhau.
  return (
    <TaskBadgeProvider>
      <div className="layout">
        <div className="content app-shell">
          <UserBar />
          <Routes>
            <Route path="/" element={<Navigate to="/menu" replace />} />
            <Route path="/menu" element={<Menu />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route
              path="/control"
              element={guard(can.control(user.role), <Control />)}
            />
            <Route
              path="/settings"
              element={guard(can.config(user.role), <Settings />)}
            />
            <Route path="/about" element={<About />} />
            {/* Mọi vai đều vào được: người xem cũng phải mở được việc của mình.
              Quyền GIAO việc chặn ở backend theo cấp bậc (auth.js), còn trang
              này chỉ ẩn ô "Giao việc mới" với ai không được phép. */}
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/change-password" element={<ChangePassword />} />
            <Route
              path="/users"
              element={guard(can.manageUsers(user.role), <Users />)}
            />
            <Route path="*" element={<Navigate to="/menu" replace />} />
          </Routes>
        </div>
      </div>
    </TaskBadgeProvider>
  );
}
