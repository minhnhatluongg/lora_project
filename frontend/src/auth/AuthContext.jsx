import { createContext, useContext, useEffect, useState } from 'react';
import { api, tokenStore } from '../api.js';

const AuthCtx = createContext(null);

// Capability helpers derived from role.
export const can = {
  control: (role) => role === 'admin' || role === 'technician',
  config: (role) => role === 'admin' || role === 'technician',
  manageUsers: (role) => role === 'admin',
};

export const ROLE_LABEL = {
  admin: 'Quản trị',
  technician: 'Kỹ thuật',
  viewer: 'Người xem',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount, if we have a token, validate it via /me.
  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const { token, user } = await api.login(username, password);
    tokenStore.set(token);
    setUser(user);
    return user;
  };

  const logout = () => {
    tokenStore.clear();
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
