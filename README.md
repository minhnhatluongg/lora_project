# 🌱 Hệ thống nông nghiệp thông minh dùng LoRa — Dashboard + Backend

Full-stack cho hệ thống ESP32 Master/Slave + LoRa:

- **Backend**: Node.js + Express + Socket.IO + **SQLite** (`better-sqlite3`)
- **Frontend**: React (Vite) + React Router + Recharts + Socket.IO client
- **Xác thực**: JWT + 3 vai trò (admin / technician / viewer)
- **API Docs**: Swagger UI tại `/api/docs`
- **ESP32**: giao tiếp với backend qua HTTP REST (xem `esp32_master_example.ino`)

```
ESP32 Slave ──LoRa──► ESP32 Master ──WiFi/HTTP──► Node backend ──REST + WebSocket──► React Dashboard
                                                        │
                                                    SQLite (data/farm.db)
```

---

## 1. Vì sao chọn SQLite?

| Tiêu chí | SQLite (đang dùng) | Khi nào nâng cấp |
|---|---|---|
| Cài đặt | Không cần — file `data/farm.db` | — |
| Chi phí | Miễn phí 100% | — |
| Phù hợp | Dự án nhỏ/vừa, đồ án, vài node | — |
| Cloud / nhiều người | Không tốt | Dùng **Supabase (PostgreSQL, free 500MB)** |
| Time-series lớn (>triệu dòng) | Khá | **InfluxDB** (free, OSS) |

Code dùng SQL chuẩn nên nâng lên PostgreSQL sau này khá dễ (đổi driver + vài cú pháp ngày giờ).

---

## 2. Chạy thử (không cần phần cứng)

Mở **2 terminal**.

### Terminal 1 — Backend
```bash
cd backend
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run seed                # nạp 24h dữ liệu mẫu cho biểu đồ
npm run dev                 # chạy ở http://localhost:4000
```

### Terminal 2 — Frontend
```bash
cd frontend
npm install
npm run dev                 # mở http://localhost:5173
```

**Đăng nhập mặc định:** `admin` / `admin123` (tạo tự động lần chạy đầu — đổi mật khẩu sau khi đăng nhập).

### Tài liệu API (Swagger)
Mở **http://localhost:4000/api/docs** — giao diện Swagger UI tương tác:
- Bấm **Authorize** → dán JWT (lấy từ `/api/auth/login`) để thử các endpoint cần đăng nhập.
- Các endpoint của ESP32 dùng `apiKeyAuth` (header `x-api-key`).

---

## 2b. Phân quyền (3 vai trò)

| Vai trò | Xem dashboard | Điều khiển bơm/van + AUTO/MANUAL | Cấu hình ngưỡng + luật tự động | Quản lý tài khoản |
|---|:--:|:--:|:--:|:--:|
| **admin** (Quản trị) | ✓ | ✓ | ✓ | ✓ |
| **technician** (Kỹ thuật) | ✓ | ✓ | ✓ | ✗ |
| **viewer** (Người xem) | ✓ | ✗ | ✗ | ✗ |

- Admin vào trang **Người dùng** để cấp tài khoản, đổi vai trò, khóa/mở, reset mật khẩu.
- Admin/Kỹ thuật vào trang **Cài đặt & Tự động** để chỉnh ngưỡng cảnh báo và luật bật/tắt van.
- **Luật tự động**: ở chế độ AUTO, mỗi lần có dữ liệu cảm biến, backend tự đánh giá luật
  (vd. "Van 1 BẬT khi độ ẩm < 50%") và đẩy lệnh xuống ESP32 — phần cứng/LoRa không phải sửa gì.

### (Tùy chọn) Terminal 3 — Giả lập ESP32
Để thấy dashboard cập nhật real-time mà chưa có phần cứng:
```bash
cd backend
node src/simulator.js
```

---

## 3. Kết nối ESP32 thật

1. Trong `backend/.env` đặt `DEVICE_API_KEY` (vd. `farm-secret-123`).
2. Trong sketch ESP32 (`esp32_master_example.ino`):
   - `BASE` = `http://<IP-máy-chạy-backend>:4000` (KHÔNG dùng `localhost`).
   - `APIKEY` = đúng giá trị `DEVICE_API_KEY`.
3. Máy chạy backend và ESP32 phải **cùng mạng WiFi/LAN**.
4. Mở port 4000 trên firewall nếu cần.

---

## 4. API tham khiếu

> - Endpoint **đọc** từ web cần header `Authorization: Bearer <JWT>` (đăng nhập để lấy).
> - Endpoint **ghi từ ESP32** cần header `x-api-key: <DEVICE_API_KEY>`.
> - Xem đầy đủ + thử trực tiếp tại **Swagger UI** `/api/docs`.

### Auth & Users
| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/auth/login` | công khai | Đăng nhập → `{token, user}` |
| GET | `/api/auth/me` | đã đăng nhập | Thông tin user hiện tại |
| GET | `/api/users` | admin | Danh sách tài khoản |
| POST | `/api/users` | admin | Tạo tài khoản. Body: `{username,password,fullName,role}` |
| PATCH | `/api/users/:id` | admin | Đổi `role`/`active`/`password`/`fullName` |
| DELETE | `/api/users/:id` | admin | Xóa tài khoản |

### Config (ngưỡng + tự động)
| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/config` | đã đăng nhập | Ngưỡng cảnh báo + luật tự động |
| PUT | `/api/config` | admin, technician | Cập nhật (merge từng phần) |

### Telemetry (dữ liệu cảm biến)
| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/telemetry` | ESP32 gửi 1 lần đọc. Body: `{temperature,humidity,ph,ec,lora_rssi,slave_online}` |
| GET | `/api/telemetry/latest` | Giá trị mới nhất (cho 4 thẻ) |
| GET | `/api/telemetry/history?hours=24` | Dữ liệu cho biểu đồ |
| GET | `/api/telemetry/recent?limit=10` | Bảng "dữ liệu mới nhất" |

### Thiết bị (bơm + 4 van)
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/devices` | Trạng thái tất cả thiết bị |
| POST | `/api/devices/:id/command` | *(admin/technician)* Yêu cầu bật/tắt. Body: `{action:"ON"\|"OFF"}` → tạo lệnh chờ |
| POST | `/api/devices/state` | ESP32 báo trạng thái relay thật. Body: `{pump:"ON",van1:"OFF",...}` |

`:id` ∈ `pump, van1, van2, van3, van4`.

### Lệnh điều khiển (hàng đợi cho ESP32)
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/commands/pending` | ESP32 poll để lấy lệnh chờ (tự chuyển sang `sent`) |
| POST | `/api/commands/:id/ack` | ESP32 xác nhận đã thực thi → cập nhật trạng thái |

### Trạng thái & chế độ
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/status` | Master/Slave online, RSSI, mode |
| POST | `/api/status/mode` | *(admin/technician)* Đổi chế độ. Body: `{mode:"AUTO"\|"MANUAL"}` |

### Cảnh báo
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/alerts?limit=10` | Cảnh báo gần nhất |
| POST | `/api/alerts` | Tạo cảnh báo. Body: `{level:"info"\|"warning"\|"danger",message}` |

Backend tự sinh cảnh báo khi vượt ngưỡng (chỉnh trong `.env`: `PH_MIN`, `PH_MAX`, `EC_MAX`, `TEMP_MAX`, `HUMIDITY_MIN`).

### WebSocket (Socket.IO, real-time)
Frontend tự lắng nghe các event:
- `telemetry` — có dữ liệu cảm biến mới
- `devices` — trạng thái thiết bị thay đổi
- `status` — trạng thái hệ thống / mode thay đổi
- `alert` — có cảnh báo mới

---

## 5. Cấu trúc thư mục
```
lora_project/
├── backend/
│   ├── src/
│   │   ├── index.js          # server + Socket.IO
│   │   ├── config.js         # đọc .env
│   │   ├── db.js             # SQLite schema + seed (admin, devices, config)
│   │   ├── auth.js           # JWT + hash mật khẩu + middleware phân quyền
│   │   ├── services.js       # devices/status/alerts/config + engine tự động
│   │   ├── openapi.js        # spec Swagger (/api/docs)
│   │   ├── middleware.js     # auth x-api-key cho ESP32
│   │   ├── realtime.js       # wrapper Socket.IO
│   │   ├── seed.js           # nạp dữ liệu mẫu (npm run seed)
│   │   ├── simulator.js      # giả lập ESP32 (node src/simulator.js)
│   │   └── routes/           # auth, users, config, telemetry, devices, commands, alerts, status
│   └── .env.example
├── frontend/
│   └── src/
│       ├── App.jsx           # router + bảo vệ route theo vai trò
│       ├── useFarm.js        # hook: REST + Socket.IO
│       ├── api.js, socket.js
│       ├── auth/             # AuthContext (JWT, vai trò)
│       ├── pages/            # Login, Dashboard, Settings, Users
│       └── components/       # Layout, Sidebar, MetricCards, RealtimeCharts, ...
└── esp32_master_example.ino  # sketch tham khảo
```

---

## 6. Bạn cần cung cấp gì cho mình (nếu muốn mình tinh chỉnh tiếp)

- Định dạng gói dữ liệu LoRa hiện tại của bạn (các trường, kiểu dữ liệu) để mình khớp với `/api/telemetry`.
- ✅ ~~Đăng nhập / phân quyền~~ → đã làm: 3 vai trò admin/technician/viewer.
- ✅ ~~Logic AUTO~~ → đã làm: cấu hình luật bật/tắt trong trang **Cài đặt & Tự động**.
  (Nếu muốn chạy AUTO **ngay trên ESP32** thay vì backend, mình có thể cho ESP32 đọc `/api/config`.)
- Triển khai chạy ở đâu: máy nội bộ, VPS, hay cloud free (Render/Railway)? → mình viết hướng dẫn deploy + Dockerfile nếu cần.
```
