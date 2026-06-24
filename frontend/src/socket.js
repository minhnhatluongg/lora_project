import { io } from 'socket.io-client';

// Empty string => same origin (Vite proxies /socket.io to the backend in dev).
const URL = import.meta.env.VITE_API_BASE || '';

export const socket = io(URL, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
});

export const EVENTS = {
  TELEMETRY: 'telemetry',
  DEVICES: 'devices',
  STATUS: 'status',
  ALERT: 'alert',
};
