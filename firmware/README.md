# 📟 Firmware — 3 board của hệ thống

```
                 ┌──────────────────────────────────────────┐
Đầu dò đất RS485 │                                          │
  + 4 siêu âm ──►│  STM32F411CE   (stm32_sensor_node/)      │
  + KK/mưa       │  đọc cảm biến, hiện LCD 1602             │
                 └──────────────┬───────────────────────────┘
                                │ LoRa E32 · 9600 · mỗi 2 phút
                                │ <DATA:14 trường>
                                ▼
                 ┌──────────────────────────────────────────┐
   Nextion HMI ◄─┤  ESP32-S3 MASTER  (esp32_master/)        ├─► WiFi ──► Backend :4000
   (5 trang)     │  logic AUTO + pha phân + cầu nối web      │           └─► Dashboard :5173
                 └──────────────┬───────────────────────────┘
                                │ LoRa E32 · <ONn>/<OFFn>/<ESTOP>
                                │ ◄── <ACK_...> , <SYNC:...>
                                ▼
                 ┌──────────────────────────────────────────┐
   Nút cơ tủ ───►│  Arduino Nano  (nano_relay/)             │
   điện          │  10 relay: 5 bơm · 4 van · 1 báo AUTO    │
                 └──────────────────────────────────────────┘
```

Ba board chạy độc lập được với nhau. **Mất WiFi hay tắt backend thì hệ thống vẫn
tưới bình thường** bằng Nextion + nút cơ; chỉ là dashboard web không cập nhật.

---

## Nạp gì, bằng gì

| Thư mục | Board | Công cụ | Thư viện cần cài |
|---|---|---|---|
| `stm32_sensor_node/` | STM32F411CE (BlackPill) | PlatformIO + ST-Link | tự tải theo `platformio.ini` |
| `esp32_master/` | ESP32-S3 | Arduino IDE | Adafruit GFX, Adafruit SSD1306 |
| `nano_relay/` | Arduino Nano | Arduino IDE | không cần |

Cầu nối web trên ESP32 **không cần thư viện ngoài** — chỉ dùng `WiFi.h` và
`HTTPClient.h` có sẵn trong core ESP32, và tự tách JSON bằng tay.

---

## Chỉ cần sửa 3 dòng là chạy

Mở `esp32_master/esp32_master.ino`, khối cấu hình nằm ngay đầu file:

```cpp
const char* ssid     = "TÊN_WIFI_CỦA_BẠN";
const char* password = "MẬT_KHẨU_WIFI";
const char* BACKEND_BASE = "http://192.168.1.50:4000";   // IP máy chạy backend
```

**Khóa API đã khớp sẵn**, không phải sửa:

```cpp
const char* DEVICE_API_KEY = "changeme-esp32-secret";   // = DEVICE_API_KEY trong backend/.env.example
```

> Lấy IP máy chạy backend bằng `ipconfig` (dòng *IPv4 Address*). **Không dùng
> `localhost`** — với ESP32, `localhost` là chính nó.
>
> Máy chạy backend và ESP32 phải **cùng một mạng WiFi**, và cổng 4000 phải được
> mở trên tường lửa Windows.

Muốn chạy hoàn toàn offline (chỉ Nextion + LoRa) thì đặt `#define ENABLE_WEB_BRIDGE 0`.

---

## Cầu nối web làm những gì

| Sự kiện | ESP32 làm gì |
|---|---|
| Nhận `<DATA:...>` từ STM32 | `POST /api/telemetry` — cả 14 trường, kể cả không khí và mưa |
| Mỗi 3 giây | `GET /api/commands/pending?limit=1` → dịch thành `<ONn>`/`<OFFn>` gửi Nano |
| Sau khi Nano ACK | `POST /api/commands/{id}/ack` |
| Bấm nút cơ dưới tủ điện | `POST /api/devices/state` ngay lập tức |
| Mỗi 20 giây | `POST /api/devices/state` để web không bao giờ lệch quá lâu |
| Web bấm DỪNG KHẨN CẤP | `GET /api/status` thấy `eStop:true` → phát `<ESTOP>` cắt sạch 10 relay |
| Web bấm Khởi động lại | ack trước rồi mới `ESP.restart()` |

**Ánh xạ thiết bị** (`device_id` của web ↔ số relay của Nano):

| Web | LoRa | Chân Nano |
|---|---|---|
| `pump1`..`pump5` | `<ON1>`..`<ON5>` | A1, A0, D2, D3, D4 |
| `van1`..`van4` | `<ON6>`..`<ON9>` | D5, D6, D7, D8 |
| — | (relay 10) | D9 — đèn báo đang ở AUTO |

---

## ⚠️ Ba điều phải kiểm trước khi chạy với phần cứng thật

### 1. Ánh xạ 4 bồn đang mâu thuẫn giữa các file

Trong chính code hiện tại, `Dist3` và `Dist4` được hiểu theo **hai cách khác nhau**:

| Nguồn | Dist3 là gì | Dist4 là gì |
|---|---|---|
| Chú thích trong `stm32_sensor_node` | Bồn Kali | Bồn Nước |
| Thứ tự hiện lên Nextion (`t8`, `t9`) | Bồn Nước | Trộn |
| Logic pha phân trong `esp32_master` | **bồn Trộn** (bơm nước vào khi > 50 cm) | **bồn Nước** (cạn khi > 80 cm) |

Cái này **ảnh hưởng đến hành vi thật**: khóa an toàn "bồn cạn" và bước "bơm nước
vào bồn trộn" đều dựa vào hai biến này. Hãy đo thực tế xem đầu dò siêu âm nào cắm
vào chân nào (`ECHO1`=PB13, `ECHO2`=PB14, `ECHO3`=PB15, `ECHO4`=PA8), rồi thống
nhất lại một cách duy nhất.

Backend đang đặt tên mặc định theo **thứ tự trên Nextion**: `dist1`=Bồn Kali,
`dist2`=Bồn Đạm, `dist3`=Bồn Nước, `dist4`=Trộn. Đổi tên được ngay trong trang
**SETTINGS → Hiệu chuẩn bồn nước**, không cần sửa code.

### 2. Cảm biến không khí và mưa vẫn là số giả

Trong `stm32_sensor_node/src/main.cpp`, hàm `readAirSensors()` đang gán cứng:

```cpp
AirTemp = 32.5;  AirHum = 70.0;  RainPercent = 15;
```

Thay bằng lệnh đọc DHT22/SHT31 và cảm biến mưa thật. Toàn tuyến từ đây lên
dashboard đã thông sẵn — cắm số thật vào là chạy.

### 3. Đừng để hai bộ não cùng điều khiển

Hệ thống có **hai** engine tự động:

- **ESP32** (`handleAutoIrrigationLogic` + `handleAutoMixingLogic`) — chạy tại
  chỗ, không cần mạng, có khóa chéo bồn cạn và trời mưa. **Đây là cái đang dùng.**
- **Backend** (trang Cài đặt → *Luật tự động*) — mặc định **tắt hết**, để đúng như vậy.

Nếu bật luật ở backend trong khi ESP32 cũng đang ở AUTO, hai bên sẽ giành nhau
cùng một relay. Khi đang ở AUTO, ESP32 từ chối mọi lệnh tay từ web và báo về
`success:false`, nên dashboard sẽ hiện lệnh **thất bại** thay vì hiện một trạng
thái không có thật — nhưng tốt nhất là chỉ dùng một bộ não.

---

## Nhịp gửi dữ liệu

STM32 gửi LoRa **mỗi 2 phút** (`LORA_SEND_INTERVAL`), nên dashboard cập nhật
theo nhịp đó. Bấm nút **PB7** trên STM32 để ép đo và gửi ngay.

Thẻ **Master** trên dashboard vẫn xanh liên tục vì ESP32 hỏi lệnh mỗi 3 giây;
thẻ **Slave** phản ánh gói LoRa gần nhất.

Muốn dày hơn thì giảm `LORA_SEND_INTERVAL` — đổi lại tốn pin và chiếm sóng nhiều hơn.

---

## Sửa lỗi thường gặp

| Hiện tượng | Nguyên nhân |
|---|---|
| Serial ESP32 in `POST /telemetry -> -1` | Sai IP backend, khác mạng WiFi, hoặc tường lửa chặn cổng 4000 |
| `-> 401` | `DEVICE_API_KEY` trong sketch khác `backend/.env` |
| Dashboard trống, Master OFFLINE | ESP32 chưa nối được WiFi — xem OLED có báo "WiFi Offline" không |
| Bấm nút trên web không có gì xảy ra | Hệ thống đang ở **TỰ ĐỘNG** — Nano khóa lệnh tay. Chuyển sang THỦ CÔNG |
| Web hiện bơm ON nhưng thực tế không chạy | Xem trang **Cảnh báo** — nếu có "lệnh không được xác nhận" thì LoRa tới Nano đang đứt |
| Ngưỡng đặt xong khởi động lại là mất | Đã sửa: trước đây `preferences.end()` bị gọi sớm nên không đọc lại được Flash |

---

## Ghi chú

- **Chưa biên dịch thử.** Máy dựng bản này không có Arduino CLI lẫn PlatformIO,
  nên phần thêm mới mới chỉ được rà tay (cân bằng ngoặc, thứ tự khai báo, kiểu
  dữ liệu). Hãy **Verify/Compile một lần** trước khi nạp chip.
- Khóa `changeme-esp32-secret` nằm công khai trong repo. Chấp nhận được với mạng
  LAN nội bộ trong phòng lab; **đổi cả hai phía** nếu mở ra Internet.
- `esp32_master.ino` giữ nguyên toàn bộ logic Nextion, AUTO và pha phân của bản
  gốc — phần thêm vào nằm gọn trong khối *"CẦU NỐI VỚI DASHBOARD WEB"*.
