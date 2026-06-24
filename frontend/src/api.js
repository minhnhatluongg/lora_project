// Thin REST client. In dev, Vite proxies /api to the backend (see vite.config.js).
// In production set VITE_API_BASE to your backend URL.
const BASE = import.meta.env.VITE_API_BASE || '';
const TOKEN_KEY = 'farm_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function req(path, options = {}) {
  const token = tokenStore.get();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (res.status === 401) {
    // Token missing/expired -> force re-login
    tokenStore.clear();
    if (!path.startsWith('/api/auth/login')) window.location.reload();
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  // auth
  login: (username, password) =>
    req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => req('/api/auth/me'),

  // telemetry
  latest: () => req('/api/telemetry/latest'),
  history: (hours = 24) => req(`/api/telemetry/history?hours=${hours}`),
  recent: (limit = 10) => req(`/api/telemetry/recent?limit=${limit}`),

  // devices
  devices: () => req('/api/devices'),
  sendDeviceCommand: (id, action) =>
    req(`/api/devices/${id}/command`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  // status / mode
  status: () => req('/api/status'),
  setMode: (mode) =>
    req('/api/status/mode', { method: 'POST', body: JSON.stringify({ mode }) }),

  // alerts
  alerts: (limit = 10) => req(`/api/alerts?limit=${limit}`),

  // config
  getConfig: () => req('/api/config'),
  updateConfig: (patch) =>
    req('/api/config', { method: 'PUT', body: JSON.stringify(patch) }),

  // users (admin)
  users: () => req('/api/users'),
  createUser: (data) =>
    req('/api/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, patch) =>
    req(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteUser: (id) => req(`/api/users/${id}`, { method: 'DELETE' }),
};
