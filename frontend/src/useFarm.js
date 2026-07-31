import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from './api.js';
import { socket, EVENTS } from './socket.js';

const MAX_POINTS = 600;
export const RANGES = [
  { hours: 1, label: '1 giờ' },
  { hours: 6, label: '6 giờ' },
  { hours: 24, label: '24 giờ' },
  { hours: 168, label: '7 ngày' },
];

// Central hook: loads initial data over REST, then keeps it live via Socket.IO.
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
    try {
      const [l, hist, r, d, s, a, c] = await Promise.all([
        api.latest(),
        api.history(h),
        api.recent(15),
        api.devices(),
        api.status(),
        api.alerts(15),
        api.getConfig(),
      ]);
      setLatest(l);
      setHistory(hist);
      setRecent(r);
      setDevices(d);
      setStatus(s);
      setAlerts(a);
      setConfig(c);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh(hours).catch(console.error);
  }, [refresh, hours]);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onTelemetry = (reading) => {
      setLatest(reading);
      setHistory((prev) => [...prev, reading].slice(-MAX_POINTS));
      setRecent((prev) => [reading, ...prev].slice(0, 15));
    };
    const onDevices = (list) => setDevices(list);
    const onStatus = (s) => setStatus(s);
    const onAlert = (a) => setAlerts((prev) => [a, ...prev].slice(0, 15));

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(EVENTS.TELEMETRY, onTelemetry);
    socket.on(EVENTS.DEVICES, onDevices);
    socket.on(EVENTS.STATUS, onStatus);
    socket.on(EVENTS.ALERT, onAlert);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(EVENTS.TELEMETRY, onTelemetry);
      socket.off(EVENTS.DEVICES, onDevices);
      socket.off(EVENTS.STATUS, onStatus);
      socket.off(EVENTS.ALERT, onAlert);
    };
  }, []);

  // Actions
  const toggleDevice = async (id, currentState) => {
    const action = currentState === 'ON' ? 'OFF' : 'ON';
    await api.sendDeviceCommand(id, action);
    // Optimistic UI; the real confirmation arrives via the 'devices' socket event.
  };

  const setMode = async (mode) => {
    const s = await api.setMode(mode);
    setStatus(s);
  };

  return {
    latest,
    history,
    recent,
    devices,
    status,
    alerts,
    config,
    thresholds: config?.thresholds,
    tanks: config?.tanks,
    hours,
    setHours,
    connected,
    loading,
    error,
    toggleDevice,
    setMode,
    refresh,
  };
}
