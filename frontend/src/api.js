// Thin REST client. In dev, Vite proxies /api to the backend (see vite.config.js).
// In production set VITE_API_BASE to your backend URL.
const BASE = import.meta.env.VITE_API_BASE || '';
const TOKEN_KEY = 'farm_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// A 401 normally means the session died, so we drop the token and bounce back to
// the login screen. Two endpoints answer 401 as a *business* result instead:
// /login (wrong credentials) and /change-password (wrong current password, see
// backend/src/routes/auth.js). Reloading on those would throw an operator out of
// the panel for a typo, so they keep their 401 and surface the message.
const SELF_HANDLES_401 = new Set([
  '/api/auth/login',
  '/api/auth/change-password',
]);

async function req(path, options = {}) {
  const token = tokenStore.get();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (res.status === 401 && !SELF_HANDLES_401.has(path.split('?')[0])) {
    // Token missing/expired -> force re-login
    tokenStore.clear();
    window.location.reload();
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
  // --- auth ---------------------------------------------------------------
  login: (username, password) =>
    req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => req('/api/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    req('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // --- telemetry ----------------------------------------------------------
  latest: () => req('/api/telemetry/latest'),
  history: (hours = 24) => req(`/api/telemetry/history?hours=${hours}`),
  recent: (limit = 10) => req(`/api/telemetry/recent?limit=${limit}`),

  // --- devices ------------------------------------------------------------
  devices: () => req('/api/devices'),
  sendDeviceCommand: (id, action) =>
    req(`/api/devices/${id}/command`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  // --- status / mode / emergency stop -------------------------------------
  status: () => req('/api/status'),
  setMode: (mode) =>
    req('/api/status/mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  // Returns the full Status object, so callers can read back `eStop` and `mode`
  // (engaging forces MANUAL) instead of guessing.
  emergencyStop: (engaged) =>
    req('/api/status/estop', {
      method: 'POST',
      body: JSON.stringify({ engaged }),
    }),

  // --- alerts -------------------------------------------------------------
  alerts: (limit = 10) => req(`/api/alerts?limit=${limit}`),

  // --- config -------------------------------------------------------------
  getConfig: () => req('/api/config'),
  updateConfig: (patch) =>
    req('/api/config', { method: 'PUT', body: JSON.stringify(patch) }),

  // --- system actions -----------------------------------------------------
  // Reboots the FIELD unit, not this server: the backend queues a RESTART
  // command the ESP32 master picks up on its next poll -> { ok, queued, commandId }.
  restartSystem: () => req('/api/system/restart', { method: 'POST' }),
  // Admin only. Resets app_config to the factory defaults and returns the new
  // config; users, telemetry and the alert log are left alone.
  restoreDefaults: () => req('/api/system/restore-defaults', { method: 'POST' }),

  // --- users (admin) ------------------------------------------------------
  users: () => req('/api/users'),
  createUser: (data) =>
    req('/api/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, patch) =>
    req(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteUser: (id) => req(`/api/users/${id}`, { method: 'DELETE' }),
};
