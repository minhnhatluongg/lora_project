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
  // Tiếng chuông trống: "có ai đó vừa đổi một công việc". KHÔNG kèm nội dung,
  // vì socket này chưa xác thực nên mọi thứ phát qua đây là phát cho tất cả
  // trình duyệt đang mở. Nghe được thì tự gọi lại REST bằng token của mình.
  TASKS: 'tasks-changed',
};
