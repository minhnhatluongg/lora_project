import { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import { socket, EVENTS } from './socket.js';

const MAX_POINTS = 144;

// Central hook: loads initial data over REST, then keeps it live via Socket.IO.
export function useFarm() {
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [recent, setRecent] = useState([]);
  const [devices, setDevices] = useState([]);
  const [status, setStatus] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [connected, setConnected] = useState(socket.connected);

  const refresh = useCallback(async () => {
    const [l, h, r, d, s, a] = await Promise.all([
      api.latest(),
      api.history(24),
      api.recent(10),
      api.devices(),
      api.status(),
      api.alerts(10),
    ]);
    setLatest(l);
    setHistory(h);
    setRecent(r);
    setDevices(d);
    setStatus(s);
    setAlerts(a);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onTelemetry = (reading) => {
      setLatest(reading);
      setHistory((prev) => [...prev, reading].slice(-MAX_POINTS));
      setRecent((prev) => [reading, ...prev].slice(0, 10));
    };
    const onDevices = (list) => setDevices(list);
    const onStatus = (s) => setStatus(s);
    const onAlert = (a) => setAlerts((prev) => [a, ...prev].slice(0, 10));

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
  }, [refresh]);

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
    connected,
    toggleDevice,
    setMode,
    refresh,
  };
}
