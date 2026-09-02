import { io } from 'socket.io-client';

// Empty string => same origin (Vite proxies /socket.io to the backend in dev).
const URL = import.meta.env.VITE_API_BASE || '';

// KHÔNG ghim `transports`. Dòng cũ là `['websocket', 'polling']`, đọc thì tưởng
// "ưu tiên websocket, hỏng thì lùi về polling" — thực tế socket.io v4 bám lấy
// transport đầu tiên và thử lại mãi, không tự lùi. Trên máy chủ IIS thật, ARR
// chưa chuyển tiếp được gói nâng cấp WebSocket, nên client thử websocket, hỏng,
// thử lại, hỏng — và KHÔNG BAO GIỜ nối được. Đo trên tên miền thật: 5 lần lỗi
// liên tiếp trong 14 giây rồi bỏ cuộc.
//
// Hệ quả là toàn bộ đường đẩy dữ liệu chết: bấm BẬT thì lệnh vẫn xuống ESP32,
// rơ-le vẫn đóng, CSDL vẫn đúng — nhưng giao diện không nhận được sự kiện nào
// nên biểu tượng đứng im cho tới khi F5.
//
// Bỏ trống thì socket.io dùng mặc định của nó: nối bằng polling trước (chạy
// được ở mọi nơi), rồi TỰ nâng cấp lên websocket khi đường truyền cho phép.
// Đo lại trên chính tên miền đó: nối được trong 149ms.
// `upgrade: false` — nối bằng polling và KHÔNG thử nâng cấp lên WebSocket.
//
// Máy chủ IIS đang chạy chặn đứng đường nâng cấp: ARR trả về 101 Switching
// Protocols đúng, nhưng kèm `Transfer-Encoding: chunked` rồi gửi luôn chunk
// rỗng "0\r\n\r\n" để KẾT THÚC phản hồi — tức là nó coi 101 như một phản hồi
// HTTP bình thường thay vì mở đường hầm. Đã thử đủ bốn thiết lập (cài
// Web-WebSockets, webSocket enabled=false ở site, responseBufferLimit=0,
// bufferChunkedResponses=false) và không cái nào đổi được hành vi đó.
//
// Không có dòng này thì mỗi lần kết nối, trình duyệt vẫn thử nâng cấp, vẫn hỏng,
// và in một dòng đỏ "WebSocket connection failed" ra console. Ứng dụng vẫn chạy
// — nhưng một lỗi đỏ thường trực là thứ không nên có trên màn hình lúc trình bày.
//
// Polling KHÔNG phải là hỏi vòng ngu ngốc: trình duyệt giữ một request mở, máy
// chủ có sự kiện là đẩy về ngay. Đo trên máy chủ thật: 25 sự kiện trong 12 giây.
// Đổi lại là tốn băng thông hơn WebSocket vì phải mở lại kết nối sau mỗi lượt.
//
// Khi nào máy chủ chuyển tiếp được WebSocket thì bỏ `upgrade: false` đi là xong.
export const socket = io(URL, { autoConnect: true, upgrade: false });

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
