import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { api } from './api.js';
import { socket, EVENTS } from './socket.js';

const MAX_POINTS = 600;
export const RANGES = [
  { hours: 1, label: '1 giờ' },
  { hours: 6, label: '6 giờ' },
  { hours: 24, label: '24 giờ' },
  { hours: 168, label: '7 ngày' },
];

// The server always ships these, but a config saved by an older build might not.
const IRRIGATION_FALLBACK = { runMinutes: 15, restMinutes: 45 };

// Central hook: loads initial data over REST, then keeps it live via Socket.IO.
// Everything a page needs about the farm comes out of here — config, thresholds,
// tank calibration, irrigation timings, devices, status (mode + e-stop) — so no
// page has to grow its own copy of the fetch/socket wiring.
export function useFarm() {
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [recent, setRecent] = useState([]);
  const [devices, setDevices] = useState([]);
  const [status, setStatus] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [config, setConfig] = useState(null);
  const [hours, setHours] = useState(24);
  const [connected, setConnected] = useState(socket.connected);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Live telemetry must only be appended to history when it belongs to the
  // window currently being displayed.
  const hoursRef = useRef(hours);
  hoursRef.current = hours;

  const refresh = useCallback(async (h = hoursRef.current) => {
    // allSettled, not all: one dead endpoint must not blank the other six. The
    // panel showing five correct readings and one gap beats a blank screen.
    const results = await Promise.allSettled([
      api.latest(),
      api.history(h),
      api.recent(15),
      api.devices(),
      api.status(),
      api.alerts(15),
      api.getConfig(),
    ]);
    const [l, hist, r, d, s, a, c] = results;
    if (l.status === 'fulfilled') setLatest(l.value);
    if (hist.status === 'fulfilled') setHistory(hist.value || []);
    if (r.status === 'fulfilled') setRecent(r.value || []);
    if (d.status === 'fulfilled') setDevices(d.value || []);
    if (s.status === 'fulfilled') setStatus(s.value);
    if (a.status === 'fulfilled') setAlerts(a.value || []);
    if (c.status === 'fulfilled') setConfig(c.value);

    const failed = results.find((x) => x.status === 'rejected');
    setError(failed ? failed.reason?.message || 'Không tải được dữ liệu' : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh(hours).catch(console.error);
  }, [refresh, hours]);

  // A reconnect means we were deaf for a while — anything that happened in the
  // gap never reached us, so re-pull instead of trusting stale state. If the
  // socket was ALREADY up when this hook mounted (navigating between pages),
  // its 'connect' never fires again for that link, so every event we see is a
  // genuine reconnect and must refetch — hence seeding from socket.connected
  // rather than a flat `true`.
  const firstConnect = useRef(!socket.connected);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      if (!firstConnect.current) refresh().catch(console.error);
      firstConnect.current = false;
    };
    const onDisconnect = () => setConnected(false);
    const onTelemetry = (reading) => {
      setLatest(reading);
      setHistory((prev) => [...prev, reading].slice(-MAX_POINTS));
      setRecent((prev) => [reading, ...prev].slice(0, 15));
    };
    const onDevices = (list) => setDevices(Array.isArray(list) ? list : []);
    const onStatus = (s) => setStatus(s);
    const onAlert = (a) => setAlerts((prev) => [a, ...prev].slice(0, 15));

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(EVENTS.TELEMETRY, onTelemetry);
    socket.on(EVENTS.DEVICES, onDevices);
    socket.on(EVENTS.STATUS, onStatus);
    socket.on(EVENTS.ALERT, onAlert);

    // Re-read the transport AFTER subscribing. `connected` was seeded during
    // render; if the socket finished connecting in the gap between that render
    // and this effect, its 'connect' already fired with no listener attached and
    // the lamp would latch on a stale "down" forever. Reading it here closes
    // that window — and marks the link as established so a genuine reconnect
    // later still triggers the catch-up refresh.
    setConnected(socket.connected);
    if (socket.connected) firstConnect.current = false;

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(EVENTS.TELEMETRY, onTelemetry);
      socket.off(EVENTS.DEVICES, onDevices);
      socket.off(EVENTS.STATUS, onStatus);
      socket.off(EVENTS.ALERT, onAlert);
    };
  }, [refresh]);

  // --- Actions --------------------------------------------------------------

  const toggleDevice = useCallback(async (id, currentState) => {
    const action = currentState === 'ON' ? 'OFF' : 'ON';
    return api.sendDeviceCommand(id, action);
    // The real confirmation arrives via the 'devices' socket event.
  }, []);

  const setMode = useCallback(async (mode) => {
    const s = await api.setMode(mode);
    setStatus((prev) => (s && typeof s === 'object' ? { ...(prev || {}), ...s } : prev));
    return s;
  }, []);

  // Engaging also forces MANUAL and cuts every actuator, so the whole Status the
  // route returns is merged in rather than just the latch flag.
  const setEmergencyStop = useCallback(async (engaged) => {
    const s = await api.emergencyStop(engaged);
    setStatus((prev) => {
      const base = { ...(prev || {}) };
      if (s && typeof s === 'object') {
        Object.assign(base, s);
        if (!('eStop' in s)) base.eStop = 'engaged' in s ? !!s.engaged : engaged;
      } else {
        base.eStop = engaged;
      }
      return base;
    });
    return s;
  }, []);

  const saveConfig = useCallback(async (patch) => {
    const next = await api.updateConfig(patch);
    setConfig(next);
    return next;
  }, []);

  const restoreDefaults = useCallback(async () => {
    const next = await api.restoreDefaults();
    setConfig(next);
    return next;
  }, []);

  const irrigation = useMemo(
    () => ({ ...IRRIGATION_FALLBACK, ...(config?.irrigation || {}) }),
    [config]
  );

  return {
    // telemetry
    latest,
    history,
    recent,
    alerts,
    hours,
    setHours,
    // actuators + system state
    devices,
    status,
    mode: status?.mode ?? null,
    // the backend field is `eStop`; tolerate a lowercase spelling from an older build
    eStop: !!(status?.eStop ?? status?.estop),
    // configuration
    config,
    thresholds: config?.thresholds,
    tanks: config?.tanks,
    automation: config?.automation,
    irrigation,
    // transport
    connected,
    loading,
    error,
    // actions
    toggleDevice,
    setMode,
    setEmergencyStop,
    saveConfig,
    restoreDefaults,
    restartSystem: api.restartSystem,
    refresh,
  };
}
