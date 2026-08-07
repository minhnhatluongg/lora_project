# 🌱 Hệ thống nông nghiệp thông minh — Dashboard + Backend

Full-stack cho node cảm biến STM32 + ESP32 Master:

- **Node cảm biến**: STM32F411CE (`testcode/`) — đầu dò đất Modbus RS485 (7 chỉ số) + 4 cảm biến siêu âm + LCD 1602
- **Giao diện**: 5 trang theo bộ thiết kế bảng điều khiển (`front_require/`) — Menu · Dashboard · Control · Settings · About
- **Backend**: Node.js + Express + Socket.IO + **SQLite** (`better-sqlite3`)
- **Frontend**: React (Vite) + React Router + Recharts + Socket.IO client
- **Xác thực**: JWT + 3 vai trò (admin / technician / viewer)
- **API Docs**: Swagger UI tại `/api/docs`

```
Đầu dò đất RS485 ──Modbus──┐
                            ├─► STM32F411 ──UART(JSON)──► ESP32 Master ──WiFi/HTTP──► Node backend ──REST + WebSocket──► React Dashboard
4 × siêu âm HC-SR04 ────────┘                                                              │
                                                                                    SQLite (data/farm.db)
```

---

## 0. Node cảm biến đo những gì

Đây là bảng mapping giữa firmware (`testcode/src/main.cpp`) và backend:

| Firmware | Thanh ghi Modbus | Trường API | Đơn vị | Ghi chú |
|---|---|---|---|---|
| `Humidity` | 0 | `humidity` | % | raw / 10 |
| `Temperature` | 1 | `temperature` | °C | raw / 10 |
| `EC_Value` | 2 | `ec` | **µS/cm** | giữ nguyên giá trị thô (1000 µS/cm = 1 mS/cm) |
| `pH_Value` | 3 | `ph` | — | raw / 10 |
| `Nitrogen` | 4 | `n` | ppm | 1 mg/kg = 1 ppm |
| `Phosphorus` | 5 | `p` | ppm | 1 mg/kg = 1 ppm |
| `Potassium` | 6 | `k` | ppm | 1 mg/kg = 1 ppm |
| `Dist1..Dist4` | — | `dist1..dist4` | cm | `-1` (hết timeout) → lưu `null` |
| *(chưa có trong firmware)* | — | `air_temp` | °C | nhiệt độ **không khí** |
| *(chưa có trong firmware)* | — | `air_humidity` | %RH | độ ẩm **không khí** |
| *(chưa có trong firmware)* | — | `rain` | % | cảm biến mưa (0 = khô, 100 = ướt đẫm; board digital gửi 0/100) |
| — | — | `level1..level4` | % | **suy ra** từ `dist` + hiệu chuẩn bồn, không lưu DB |
| các nhánh lỗi Modbus | — | `sensor_status` | — | `OK` / `CRC` / `HEADER` / `TIMEOUT` / `SHORT` |

> ⚠️ **3 dòng `air_temp` / `air_humidity` / `rain` backend đã sẵn sàng nhận, nhưng
> `testcode/src/main.cpp` chưa đọc chúng.** Dashboard sẽ hiện `--` cho tới khi bổ
> sung phần đọc cảm biến không khí (vd. DHT22/SHT31) và cảm biến mưa vào firmware,
> rồi thêm 3 trường đó vào `sendUplink()`. Mọi trường đều tùy chọn nên firmware cũ
> vẫn chạy bình thường, không cần sửa gấp.

**4 cảm biến siêu âm = mực nước 4 bồn chứa.** Cảm biến đo khoảng cách từ đầu dò
xuống mặt nước, backend quy ra % theo hiệu chuẩn 2 điểm đặt trong trang
**Cài đặt & Tự động**:

```
mức nước % = (emptyCm − khoảng_cách_đo) / (emptyCm − fullCm) × 100      (kẹp 0..100)
```

Đo `emptyCm` một lần khi bồn cạn và `fullCm` một lần khi bồn đầy là xong — đổi
hiệu chuẩn sẽ áp dụng ngược lại cho cả dữ liệu lịch sử vì % được tính lúc đọc.

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

> 🔌 **Muốn nối thiết bị thật để đo ngoài đồng?**
> Xem [**HUONG-DAN-CHAY-THAT.md**](HUONG-DAN-CHAY-THAT.md) — hướng dẫn từng bước
> từ đấu dây, nạp firmware, hiệu chuẩn bồn nước đến xử lý lỗi RS485.
> Phần dưới đây chỉ để chạy thử phần mềm khi chưa có phần cứng.

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

## 3. Kết nối phần cứng thật

### 3.1 Đấu dây STM32 ↔ ESP32

`Serial1` (PA9/PA10) đã dành cho RS485 và `Serial` (USB CDC) dành cho debug, nên
kênh lên ESP32 dùng **USART2**:

| STM32F411CE | | ESP32 |
|---|---|---|
| PA2 (TX2) | ──► | GPIO16 (RX2) |
| PA3 (RX2) | ◄── | GPIO17 (TX2) |
| GND | ─── | GND *(bắt buộc chung mass)* |

Sau mỗi lượt đọc, STM32 in **một dòng JSON** ra kênh này (hàm `sendUplink()`):

```json
{"temperature":31.2,"humidity":45.6,"ph":6.5,"ec":1200,"n":118,"p":57,"k":190,
 "dist1":42.5,"dist2":88.0,"dist3":31.2,"dist4":-1.0,"sensor_status":"OK"}
```

ESP32 đọc tới `\n`, chèn thêm `lora_rssi` + `slave_online` rồi POST thẳng lên
`/api/telemetry` — không phải map lại tên trường.

> Dòng JSON được gửi ở **mọi** nhánh kết thúc của vòng lặp, kể cả khi Modbus lỗi.
> Khi đó 7 chỉ số đất giữ giá trị đọc được lần cuối, nhưng `sensor_status` sẽ là
> `CRC`/`HEADER`/`TIMEOUT`/`SHORT` và dashboard hiện đúng lý do ở thẻ **RS485**.
> Riêng 4 khoảng cách siêu âm vẫn luôn mới, vì chúng được đo độc lập với RS485.

### 3.2 Cấu hình backend

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

### Config (ngưỡng + hiệu chuẩn bồn + tự động)
| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/config` | đã đăng nhập | `{thresholds, tanks, automation}` |
| PUT | `/api/config` | admin, technician | Cập nhật (merge từng phần, sâu 1 cấp với `tanks`/`automation`) |

Ngưỡng gồm: `phMin`, `phMax`, `ecMax` (µS/cm), `tempMax`, `humidityMin`,
`nMin`, `pMin`, `kMin` (ppm), `tankLowPct` (%).

### Telemetry (dữ liệu cảm biến)
| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/telemetry` | ESP32 gửi 1 lượt đọc — xem body bên dưới |
| GET | `/api/telemetry/latest` | Giá trị mới nhất (thẻ KPI, bồn nước, NPK) |
| GET | `/api/telemetry/history?hours=24` | Dữ liệu cho biểu đồ (1 / 6 / 24 / 168 giờ) |
| GET | `/api/telemetry/recent?limit=15` | Bảng "dữ liệu mới nhất" |

Body của `POST /api/telemetry`:

```json
{"temperature":32.5,"humidity":78,"ph":6.5,"ec":1500,
 "n":118,"p":57,"k":190,
 "dist1":42.5,"dist2":88,"dist3":31.2,"dist4":-1,
 "lora_rssi":-72,"slave_online":true,"sensor_status":"OK"}
```

- Nhận cả tên biến gốc trong firmware (`Temperature`, `Nitrogen`, `Dist1`, …)
  lẫn tên rút gọn, nên ESP32 gửi kiểu nào cũng được.
- `dist* = -1` → lưu `null` (cảm biến không phản hồi).
- Mọi endpoint GET trả kèm `level1..level4` (%) đã tính sẵn từ hiệu chuẩn bồn.

### Thiết bị (bơm + 4 van)
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/devices` | Trạng thái tất cả thiết bị |
| POST | `/api/devices/:id/command` | *(admin/technician)* Yêu cầu bật/tắt. Body: `{action:"ON"\|"OFF"}` → tạo lệnh chờ |
| POST | `/api/devices/state` | ESP32 báo trạng thái relay thật. Body: `{pump1:"ON",van1:"OFF",...}` |

`:id` ∈ `pump1..pump5, van1..van4` — **5 bơm + 4 van**.

> Id cũ `pump` vẫn được chấp nhận và tự quy về `pump1`, nên ESP32 đang chạy ngoài
> hiện trường không cần nạp lại firmware ngay. Database tự đổi tên `pump` → `pump1`
> khi nâng cấp (đổi tên chứ không xóa-tạo, nên bơm đang chạy không bị nhảy về OFF).

### Dừng khẩn cấp
| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/status/estop` | *(admin/technician)* Body: `{engaged:true\|false}` |

Khi bật: tắt toàn bộ thiết bị, ép về MANUAL, và **chặn thật** — mọi lệnh BẬT trả
`409`, đổi sang AUTO trả `409`, engine tự động ngừng chạy. Lệnh TẮT luôn được phép.

### Hệ thống
| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/system/restart` | *(admin/technician)* Đưa lệnh `RESTART` vào hàng đợi cho ESP32 — **không** tắt tiến trình Node |
| POST | `/api/system/restore-defaults` | *(admin)* Đưa cấu hình về mặc định gốc, giữ nguyên tài khoản và dữ liệu đo |
| POST | `/api/auth/change-password` | Đổi mật khẩu chính mình. Body: `{currentPassword,newPassword}` |

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

Backend tự sinh cảnh báo khi vượt ngưỡng: pH, EC, nhiệt độ, độ ẩm, **N/P/K thấp**,
**bồn cạn** và **siêu âm mất tín hiệu**. Một điều kiện chỉ báo **một lần** rồi im
cho tới khi hết lỗi hoặc quá `ALERT_REPEAT_SECONDS` (mặc định 10 phút) — nếu không
thì cứ 5 giây lại có thêm một cảnh báo giống hệt.

Giá trị trong `.env` chỉ dùng để **khởi tạo lần đầu**; sau đó chỉnh trực tiếp
trong trang **Cài đặt & Tự động** (lưu vào DB).

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
│       ├── metrics.js        # nhãn/đơn vị/màu/ngưỡng của mọi chỉ số (dùng chung)
│       ├── useFarm.js        # hook: REST + Socket.IO + config + khoảng thời gian
│       ├── api.js, socket.js
│       ├── auth/             # AuthContext (JWT, vai trò)
│       ├── pages/            # Login, Dashboard, Settings, Users
│       └── components/       # MetricCards, TankLevels, NpkPanel, RealtimeCharts,
│                             # StatusPanel, RecentTable, AlertsList, Sparkline, ...
├── testcode/                 # firmware STM32F411 (PlatformIO)
│   └── src/main.cpp          #   Modbus RS485 + 4 siêu âm + LCD + sendUplink()
└── esp32_master_example.ino  # cầu nối UART -> WiFi -> backend
```

---

## 5b. Giao diện có gì

Giao diện dựng theo bộ thiết kế bảng điều khiển trong `front_require/` — nền
sáng, nhãn song ngữ Việt–Anh, icon nét vẽ (không dùng emoji), và bố cục vừa khít
màn hình cảm ứng **1024×600** mà không phải cuộn.

| Trang | Đường dẫn | Nội dung |
|---|---|---|
| **MENU** | `/menu` | 6 ô: Dashboard · Control · Settings · About · Đổi mật khẩu · Đăng xuất |
| **DASHBOARD** | `/dashboard` | Hàng 1: nhiệt độ · độ ẩm · pH · EC. Hàng 2: Kali & Đạm · độ ẩm không khí · nhiệt độ không khí · cảm biến mưa · mực nước 4 bồn |
| **CONTROL** | `/control` | Thủ công/Tự động · 5 bơm · 4 van · nút **DỪNG KHẨN CẤP** |
| **SETTINGS** | `/settings` | Ngưỡng MIN/MAX (pH, EC, nhiệt độ, độ ẩm) · thời gian tưới & nghỉ · khởi động lại · khôi phục gốc |
| **ABOUT** | `/about` | Tên đề tài · GVHD · 7 thành viên nhóm |

EC hiển thị **mS/cm** đúng như thiết kế, nhưng vẫn **lưu µS/cm** như đầu dò trả
về — trang Cài đặt ghi rõ giá trị quy đổi bên dưới ô nhập để đối chiếu.

**Cuộn xuống dưới Dashboard và Settings** còn phần đi sâu mà bảng HMI không có
chỗ chứa: biểu đồ 4 tab × 4 mốc thời gian, bảng dữ liệu, danh sách cảnh báo,
hiệu chuẩn bồn nước và bảng luật AUTO. Nút QUAY LẠI dính đáy màn hình nên luôn
bấm được dù cuộn tới đâu.

Bốn màu chuỗi dữ liệu (xanh dương · xanh lá ngọc · tím hồng · cam) lấy từ thiết
kế rồi kiểm tra tự động trên nền trắng: mọi cặp cách nhau ≥ 9.7 ΔE dưới cả ba
dạng mù màu, đạt tương phản ≥ 3:1. Màu trạng thái (xanh/vàng/đỏ) giữ riêng,
không dùng làm màu chuỗi, và trạng thái luôn kèm biểu tượng + chữ.


## 6. Còn lại / có thể làm tiếp

- ✅ ~~Đăng nhập / phân quyền~~ → 3 vai trò admin/technician/viewer.
- ✅ ~~Logic AUTO~~ → cấu hình luật trong trang **Cài đặt & Tự động**; luật có thể
  dựa trên cả **mực nước bồn (%)** và NPK, không chỉ nhiệt độ/độ ẩm.
- ✅ ~~Khớp dữ liệu firmware~~ → NPK + 4 siêu âm + trạng thái Modbus đã thông suốt
  từ `main.cpp` đến dashboard.
- ✅ ~~Giao diện 5 trang theo thiết kế~~ → Menu/Dashboard/Control/Settings/About,
  vừa khít màn 1024×600.
- ⬜ **Firmware chưa đọc cảm biến không khí + mưa.** Backend, API và 3 thẻ trên
  dashboard đã sẵn sàng; còn thiếu phần đọc DHT22/SHT31 + board cảm biến mưa
  trong `testcode/src/main.cpp` và 3 trường tương ứng trong `sendUplink()`.
- ⬜ **5 bơm mới chỉ có ở phần mềm.** Backend và trang CONTROL đã điều khiển được
  `pump1..pump5`, nhưng ESP32 cần đấu đủ 5 relay và hiện thực `driveRelay()` cho
  từng id thì lệnh mới ra tới phần cứng.
- ⬜ **Chưa build thử firmware**: máy này chưa cài PlatformIO nên phần sửa
  `testcode/src/main.cpp` mới chỉ được rà soát thủ công. Chạy `pio run` một lần
  trước khi nạp chip.
- ⬜ Nếu muốn chạy AUTO **ngay trên STM32/ESP32** thay vì backend: cho ESP32 đọc
  `/api/config` rồi tự quyết định — phần cứng sẽ vẫn hoạt động khi mất mạng.
- ⬜ Triển khai: máy nội bộ, VPS, hay cloud free (Render/Railway)? → viết hướng
  dẫn deploy + Dockerfile nếu cần.
```
