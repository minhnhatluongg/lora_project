# 🌱 Hệ thống nông nghiệp thông minh — Dashboard + Backend

Full-stack cho node cảm biến STM32 + ESP32 Master:

- **Phần cứng**: 3 trạm trong `firmware/` — STM32 (đo) · ESP32 (master + Nextion) · Arduino Nano (10 relay)
- **Giao diện**: 5 trang theo bộ thiết kế bảng điều khiển (`front_require/`) — Menu · Dashboard · Control · Settings · About
- **Backend**: Node.js + Express + Socket.IO + **SQLite** (`better-sqlite3`)
- **Frontend**: React (Vite) + React Router + Recharts + Socket.IO client
- **Xác thực**: JWT + 3 vai trò (admin / technician / viewer)
- **API Docs**: Swagger UI tại `/api/docs`

```
Đầu dò đất RS485 ──Modbus──┐
4 × siêu âm HC-SR04 ───────┼─► STM32F411 ──LoRa E32──► ESP32 MASTER ──WiFi/HTTP──► Node backend :4000 ──► React Dashboard :5173
Không khí + mưa ───────────┘   (TRẠM ĐO)   <DATA:...>   (TRẠM TRUNG TÂM)      │
                                                             │          SQLite (data/farm.db)
                                                   Nextion HMI│
                                                             │ LoRa E32 <ONn>/<OFFn>
                                                             ▼        ◄── <ACK>/<SYNC>
                                                   Arduino Nano (TỦ ĐIỆN)
                                                   10 relay: 5 bơm · 4 van · 1 báo AUTO
```

**Ba trạm phần cứng chạy độc lập với nhau.** Mất WiFi hay tắt backend thì hệ
thống vẫn tưới bình thường bằng Nextion và nút cơ dưới tủ điện — chỉ dashboard
web là không cập nhật.

---

## 0. Node cảm biến đo những gì

Bảng mapping giữa firmware (`firmware/stm32_sensor_node/src/main.cpp`) và backend.
STM32 đóng cả 14 thông số vào một gói LoRa rồi ESP32 dịch sang JSON:

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
| `RainPercent` | — | `rain` | % | 0 = khô, 100 = ướt đẫm (board digital gửi 0/100) |
| `AirTemp` | — | `air_temp` | °C | nhiệt độ **không khí** |
| `AirHum` | — | `air_humidity` | %RH | độ ẩm **không khí** |
| — | — | `level1..level4` | % | **suy ra** từ `dist` + hiệu chuẩn bồn, không lưu DB |
| ESP32 suy ra | — | `sensor_status` | — | `OK` / `TIMEOUT` khi đầu dò RS485 im lặng |

> ⚠️ **Ba trường không khí / mưa đã có trong gói LoRa, nhưng hàm `readAirSensors()`
> trong STM32 vẫn đang gán số cứng** (`AirTemp = 32.5; AirHum = 70.0; RainPercent = 15;`).
> Đấu board cảm biến thật vào **và** thay 3 dòng đó thì số mới là thật. Mọi trường
> đều tùy chọn nên hệ thống vẫn chạy bình thường trong lúc chưa lắp.

**4 cảm biến siêu âm = mực nước 4 bồn chứa.** Cảm biến đo khoảng cách từ đầu dò
xuống mặt nước, backend quy ra % theo hiệu chuẩn 2 điểm đặt trong trang
**SETTINGS → Hiệu chuẩn bồn nước**:

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
>
> - 📄 [**HUONG-DAN-TRIEN-KHAI.docx**](HUONG-DAN-TRIEN-KHAI.docx) — bản Word 9 trang:
>   **bảng tra biến cấu hình theo từng máy**, các bước chạy, nghiệm thu, lỗi thường gặp.
> - 📟 [**firmware/README.md**](firmware/README.md) — nạp 3 board, ánh xạ thiết bị,
>   những gì cầu nối web làm.
> - 🔧 [**HUONG-DAN-CHAY-THAT.md**](HUONG-DAN-CHAY-THAT.md) — đấu dây chi tiết và
>   xử lý lỗi RS485.
>
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
- Admin/Kỹ thuật vào trang **SETTINGS** để chỉnh ngưỡng cảnh báo và luật bật/tắt van.
- **Luật tự động**: ở chế độ AUTO, mỗi lần có dữ liệu cảm biến, backend tự đánh giá luật
  (vd. "Van 1 BẬT khi độ ẩm < 50%") và đẩy lệnh xuống ESP32 — phần cứng/LoRa không phải sửa gì.

> ⚠️ **Hai bộ não tự động — chỉ dùng một.** ESP32 đã có sẵn state machine tưới và
> pha phân chạy tại chỗ (không cần mạng, có khóa chéo bồn cạn/trời mưa). Luật tự
> động ở backend **mặc định tắt hết** — để nguyên như vậy, nếu không hai bên sẽ
> giành nhau cùng một relay. Chi tiết ở [HUONG-DAN-CHAY-THAT.md](HUONG-DAN-CHAY-THAT.md).

### (Tùy chọn) Terminal 3 — Giả lập ESP32
Để thấy dashboard cập nhật real-time mà chưa có phần cứng:
```bash
cd backend
node src/simulator.js
```

---

## 3. Kết nối phần cứng thật

> Đấu dây chi tiết từng chân, nạp firmware và xử lý lỗi:
> xem [**HUONG-DAN-CHAY-THAT.md**](HUONG-DAN-CHAY-THAT.md).
> Dưới đây chỉ là phần tối thiểu để nối được lên backend.

### 3.1 Đường dữ liệu

Cả hai chặng đều đi qua **LoRa E32**, không phải UART thẳng:

| Chặng | Nội dung truyền |
|---|---|
| STM32 → ESP32 | `<DATA:Temp,Hum,EC,pH,N,P,K,D1,D2,D3,D4,Rain,AirTemp,AirHum>` mỗi 2 phút |
| ESP32 → Nano | `<ON1>`…`<ON9>` / `<OFF1>`…`<OFF9>` / `<ESTOP>` / `<SET_MODE=…>` |
| Nano → ESP32 | `<ACK_…>` xác nhận, `<SYNC:BOM1=1>` khi bấm nút cơ dưới tủ |

ESP32 nhận gói `<DATA:…>`, chèn thêm `slave_online` + `sensor_status`, đóng thành
JSON rồi `POST /api/telemetry`.

> Chiều RX/TX của module LoRa dễ đấu ngược: **RX của board nối vào TXD của
> module**, TX nối vào RXD. Nối TX↔TXD là hai bên im lặng hoàn toàn.

### 3.2 Cấu hình để chạy được

1. `backend/.env` — chép từ `.env.example`, **chạy được ngay không cần sửa**
   (`DEVICE_API_KEY` đã khớp sẵn với firmware).
2. `firmware/esp32_master/esp32_master.ino` — sửa **đúng 3 dòng** ở khối cấu hình
   đầu file:
   - `ssid` / `password` — WiFi của bạn
   - `BACKEND_BASE` = `http://<IP-máy-chạy-backend>:4000` (**KHÔNG** dùng `localhost`)
3. Máy chạy backend và ESP32 phải **cùng mạng WiFi/LAN**.
4. Mở cổng 4000 trên tường lửa.

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
trong trang **SETTINGS** (lưu vào DB).

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
├── firmware/                 # 3 board thật, đã cấu hình sẵn để tải về là chạy
│   ├── stm32_sensor_node/    #   STM32F411 — cảm biến + LCD, phát LoRa E32
│   ├── esp32_master/         #   ESP32-S3 — Nextion + logic AUTO + CẦU NỐI WEB
│   ├── nano_relay/           #   Arduino Nano — 10 relay (5 bơm, 4 van)
│   └── README.md
├── front_require/            # ảnh thiết kế HMI gốc của nhóm (tham chiếu)
├── testcode/                 # bản STM32 cũ, giữ để đối chiếu
└── esp32_master_example.ino  # sketch mẫu tối giản (bản đầy đủ ở firmware/)
```

### Firmware đã nối sẵn vào API

`firmware/esp32_master/` là bản **đã cắm sẵn khóa API**, chỉ cần sửa 3 dòng
(tên WiFi, mật khẩu WiFi, IP máy chạy backend) là chạy được ngay:

| Sự kiện | ESP32 gọi API nào |
|---|---|
| Nhận gói LoRa từ STM32 | `POST /api/telemetry` (đủ 14 trường) |
| Mỗi 3 giây | `GET /api/commands/pending?limit=1` → dịch thành `<ONn>`/`<OFFn>` |
| Nano xác nhận xong | `POST /api/commands/{id}/ack` |
| Bấm nút cơ dưới tủ điện | `POST /api/devices/state` |
| Web bấm DỪNG KHẨN CẤP | `GET /api/status` thấy `eStop` → phát `<ESTOP>` |

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
- ✅ ~~Logic AUTO~~ → cấu hình luật trong trang **SETTINGS**; luật có thể
  dựa trên cả **mực nước bồn (%)** và NPK, không chỉ nhiệt độ/độ ẩm.
- ✅ ~~Khớp dữ liệu firmware~~ → NPK + 4 siêu âm + không khí + mưa + trạng thái
  Modbus đã thông suốt từ STM32 qua LoRa, qua ESP32, tới dashboard.
- ✅ ~~Giao diện 5 trang theo thiết kế~~ → Menu/Dashboard/Control/Settings/About,
  vừa khít màn 1024×600.
- ✅ ~~Nối firmware vào API~~ → `firmware/esp32_master/` đã cắm sẵn khóa API, chỉ
  cần sửa 3 dòng (WiFi + IP backend) là chạy.
- ✅ ~~AUTO chạy được khi mất mạng~~ → ESP32 có sẵn state machine tưới và pha phân
  chạy tại chỗ, không phụ thuộc backend.
- ⬜ **Cảm biến không khí + mưa chưa đọc thật.** Gói LoRa đã có sẵn 3 trường, chỉ
  còn thay hàm `readAirSensors()` trong `firmware/stm32_sensor_node/src/main.cpp`
  (hiện gán cứng `32.5 / 70.0 / 15`) bằng lệnh đọc DHT22/SHT31 + board mưa.
- ⬜ **Bơm 2–5 chưa đấu relay.** Backend, trang CONTROL, ESP32 và Nano đã điều
  khiển được `pump1..pump5`; chỉ còn đấu dây relay thật ở tủ điện.
- ⬜ **Ánh xạ `Dist3`/`Dist4` đang mâu thuẫn** giữa chú thích STM32, thứ tự Nextion
  và logic pha phân của ESP32 — cần đo dây thật rồi thống nhất. Xem cảnh báo cuối
  [HUONG-DAN-CHAY-THAT.md](HUONG-DAN-CHAY-THAT.md).
- ⬜ **Chưa biên dịch thử firmware**: máy dựng bản này không có PlatformIO lẫn
  Arduino CLI, nên phần sửa trong `firmware/` mới chỉ được rà tay. Bấm
  Verify/`pio run` một lần trước khi nạp chip.
- ⬜ Triển khai: máy nội bộ, VPS, hay cloud free (Render/Railway)? → viết hướng
  dẫn deploy + Dockerfile nếu cần.
