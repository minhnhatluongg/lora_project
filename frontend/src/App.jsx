import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, can } from './auth/AuthContext.jsx';
import { Login } from './pages/Login.jsx';
import { Layout } from './components/Layout.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Settings } from './pages/Settings.jsx';
import { Users } from './pages/Users.jsx';

export default function App() {
  const { user, loading } = useAuth();

  if (loading)
    return <div className="full-center">Đang tải…</div>;

  if (!user) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route
          path="settings"
          element={can.config(user.role) ? <Settings /> : <Navigate to="/" />}
        />
        <Route
          path="users"
          element={can.manageUsers(user.role) ? <Users /> : <Navigate to="/" />}
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}
