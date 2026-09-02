// Thin wrapper around the Socket.IO instance so routes can emit events
// without importing the whole server.
let io = null;

export function setIO(instance) {
  io = instance;
}

export function emit(event, payload) {
  if (io) io.emit(event, payload);
}

// Event names shared with the frontend
export const EVENTS = {
  TELEMETRY: 'telemetry',          // new sensor reading
  DEVICES: 'devices',              // device state list changed
  STATUS: 'status',                // system status changed
  ALERT: 'alert',                  // new alert created
  // Cố ý là một tiếng chuông TRỐNG, không mang nội dung việc. Socket chưa xác
  // thực (client nối vào không kèm token, server không chia phòng theo người),
  // nên mọi thứ phát qua đây là phát cho tất cả trình duyệt đang mở. Client
  // nghe được thì tự gọi lại /api/tasks bằng token của mình.
  TASKS: 'tasks-changed',          // ai đó vừa tạo/sửa/xóa một công việc
  // Cũng là chuông trống, cùng lý do như TASKS: socket chưa xác thực nên phát
  // gì qua đây là phát cho MỌI trình duyệt đang mở, kể cả chưa đăng nhập. Cấu
  // hình không phải bí mật, nhưng /api/config vẫn đòi đăng nhập mới đọc được —
  // đẩy nguyên nội dung qua socket là lặng lẽ mở toang đúng cái cửa đó.
  CONFIG: 'config-changed',        // ngưỡng/hiệu chuẩn vừa đổi, ở BẤT KỲ đâu
};
