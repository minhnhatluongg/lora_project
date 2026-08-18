# 🔌 Hướng dẫn đưa hệ thống chạy thật với thiết bị đo

Tài liệu này đi từ "máy tính chỉ có code" đến "dashboard hiển thị số đo thật từ
ngoài đồng". Làm tuần tự từ trên xuống — **mỗi bước đều có mốc nghiệm thu**, đừng
sang bước sau khi bước trước chưa đạt, vì càng về sau càng khó biết lỗi nằm ở đâu.

Toàn tuyến gồm **3 trạm phần cứng** và **2 chương trình trên máy tính**:

```
Đầu dò đất RS485 ──Modbus 9600──┐
4 × HC-SR04 ────────────────────┼─► STM32F411 ──LoRa E32──► ESP32 MASTER ──WiFi──► Backend :4000
Cảm biến không khí + mưa ───────┘   (TRẠM ĐO)   <DATA:...>   (TRẠM TRUNG TÂM)         │
                                                                  │                    ▼
                                                        Nextion HMI │            Dashboard :5173
                                                                  │
                                                    LoRa E32 <ONn>/<OFFn> ▼ <ACK>/<SYNC>
                                                            Arduino Nano (TỦ ĐIỆN)
                                                            10 relay: 5 bơm · 4 van · 1 báo AUTO
```

> **Ba trạm chạy độc lập được với nhau.** Mất WiFi hay tắt backend thì hệ thống
> **vẫn tưới bình thường** bằng Nextion và nút cơ dưới tủ điện; chỉ dashboard web
> là không cập nhật.

---

## 0. Chuẩn bị

### Phần cứng
- [ ] Board **STM32F411CE (BlackPill)** + mạch nạp **ST-Link V2**
- [ ] **ESP32** (DevKit / ESP32-S3) + cáp USB
- [ ] **Arduino Nano** + mạch relay (code hỗ trợ **10 kênh**: 5 bơm, 4 van, 1 đèn báo AUTO)
- [ ] **3 module LoRa E32** — một cho mỗi trạm: STM32, ESP32, Nano
- [ ] Màn hình **Nextion** (nối vào ESP32)
- [ ] Màn hình **OLED SSD1306 128×32** (nối vào ESP32, I2C)
- [ ] Đầu dò đất **RS485 7-in-1** (T/H/EC/pH/N/P/K) — thường cần nguồn **9–24 V**
- [ ] Module **TTL ↔ RS485 tự động đảo chiều** (auto flow control). Firmware
      **không lái chân DE/RE**, nên module có DE/RE rời sẽ không chạy được.
- [ ] **4 × HC-SR04**
- [ ] Cảm biến **nhiệt độ + độ ẩm không khí** (DHT22 / SHT31) và **board cảm biến mưa**
- [ ] **LCD 1602 I2C** (địa chỉ 0x27) cho trạm STM32
- [ ] 2 nút nhấn + **2 điện trở kéo lên 10 kΩ** (firmware dùng `INPUT`, *không*
      dùng `INPUT_PULLUP`, nên bắt buộc có trở kéo lên ngoài)
- [ ] Nguồn 5 V đủ khỏe
- [ ] Điện trở **120 Ω** cho hai đầu bus RS485 nếu dây dài trên ~10 m

### Phần mềm trên PC
- [ ] **Node.js 18+** — kiểm tra bằng `node -v`
- [ ] **PlatformIO** (extension trong VS Code) để nạp STM32
- [ ] **Arduino IDE** có board ESP32 + board Arduino Nano

Thư viện cần cài trong Arduino IDE (**chỉ cho ESP32**):

| Thư viện | Dùng để |
|---|---|
| `Adafruit GFX Library` | vẽ màn OLED |
| `Adafruit SSD1306` | driver OLED |

> Cầu nối web **không cần ArduinoJson**. Nó chỉ dùng `WiFi.h` và `HTTPClient.h`
> có sẵn trong core ESP32, và tự tách JSON bằng tay — bớt được một thư viện phải
> cài đúng phiên bản.

---

## Bước 1 — Đấu dây

### 1.1 Trạm đo — STM32F411CE

| Khối | Chân STM32 | Nối tới |
|---|---|---|
| RS485 | **PA9** (TX1) | `DI` của module RS485 |
| | **PA10** (RX1) | `RO` của module RS485 |
| | | `A` / `B` của module ra 2 dây đầu dò đất |
| Siêu âm (TRIG chung) | **PB12** | `Trig` của **cả 4** cảm biến |
| | **PB13** | `Echo` cảm biến 1 |
| | **PB14** | `Echo` cảm biến 2 |
| | **PB15** | `Echo` cảm biến 3 |
| | **PA8** | `Echo` cảm biến 4 |
| LCD I2C | **PB9** (SDA) / **PB8** (SCL) | LCD 1602 |
| Nút nhấn | **PB5** | nút đổi trang LCD (qua trở kéo lên 10 kΩ về 3V3) |
| | **PB7** | nút đo ngay + gửi LoRa (qua trở kéo lên 10 kΩ về 3V3) |
| **LoRa E32** | **PA3** = RX của STM32 | ← nối vào **TXD** của module LoRa |
| | **PA2** = TX của STM32 | → nối vào **RXD** của module LoRa |
| | **PA5** | `M0` của module LoRa |
| | **PA6** | `M1` của module LoRa |
| | **GND** | chung mass với module LoRa |

> ⚠️ **Chú ý chiều RX/TX của LoRa.** Trong code là
> `HardwareSerial loraSerial(PA3, PA2);` — tham số thứ nhất là **RX**, thứ hai là
> **TX**. Vậy **PA3 là RX** (nối vào TXD của LoRa) và **PA2 là TX** (nối vào RXD
> của LoRa). Nối TX↔TXD và RX↔RXD là lỗi kinh điển, hai bên sẽ im lặng hoàn toàn.

### 1.2 Trạm trung tâm — ESP32

| Khối | Chân ESP32 | Nối tới |
|---|---|---|
| **LoRa E32** | **GPIO18** = RX | ← **TXD** của module LoRa |
| | **GPIO17** = TX | → **RXD** của module LoRa |
| | **GPIO5** | `M0` |
| | **GPIO6** | `M1` |
| | **GPIO8** | `AUX` |
| **Nextion** | **GPIO12** = RX | ← TX của Nextion |
| | **GPIO11** = TX | → RX của Nextion |
| **OLED** | **GPIO9** (SDA) / **GPIO10** (SCL) | SSD1306 |
| | **GND** | chung mass với **mọi** module |

Các chân này khai báo ngay đầu file `firmware/esp32_master/esp32_master.ino` —
đổi được nếu bạn đấu khác.

### 1.3 Trạm tủ điện — Arduino Nano

| Khối | Chân Nano | Nối tới |
|---|---|---|
| **LoRa E32** | **D11** = RX | ← **TXD** của module LoRa |
| | **D12** = TX | → **RXD** của module LoRa |
| | **D10** | `AUX` |
| Nút cơ tủ điện | **A3** = RX / **A2** = TX | UART sang board nút nhấn |
| Relay 1–5 (Bơm 1–5) | **A1, A0, D2, D3, D4** | tín hiệu relay |
| Relay 6–9 (Van 1–4) | **D5, D6, D7, D8** | tín hiệu relay |
| Relay 10 | **D9** | đèn báo đang ở chế độ AUTO |

### ⚠ Ba điểm dễ hỏng phần cứng

1. **Chân Echo của HC-SR04 xuất 5 V.** Đa số chân digital của F411 chịu được 5 V
   (chân FT), nhưng hãy tra datasheet đúng chân bạn dùng. An toàn nhất: mỗi Echo
   qua cầu chia áp 1 kΩ / 2 kΩ xuống ~3.3 V.
2. **HC-SR04 cần VCC 5 V** mới hoạt động ổn định. Trig nhận mức 3.3 V từ STM32
   vẫn kích được, nên chỉ cần cấp 5 V cho VCC.
3. **4 cảm biến dùng chung chân Trig** → cả 4 phát sóng cùng lúc mỗi lần đo, dù
   firmware chỉ đọc lần lượt từng Echo. Khi lắp, **hướng 4 cảm biến ra 4 phía
   khác nhau**, tránh cho chúng nhìn thấy nhau hoặc nhìn vào cùng một mặt phản xạ.

---

## Bước 2 — Nạp trạm đo STM32

```bash
cd firmware/stm32_sensor_node
pio run                 # biên dịch — chạy lần này TRƯỚC khi nạp
pio run -t upload       # nạp qua ST-Link
pio device monitor      # xem log, 115200 baud
```

> Nếu chưa quen CLI: mở thư mục `firmware/stm32_sensor_node` bằng VS Code có
> PlatformIO, rồi bấm nút **✓** (Build) và **→** (Upload) ở thanh dưới.

**Nghiệm thu bước 2** — trên Serial monitor phải thấy lặp lại:

```
Do am dat: 45.6 %
Nhiet do:  31.2 °C
EC:        1200 us/cm
pH:        6.5
Nito (N):  118 mg/kg
...
>> [LORA TX -> ESP32 HMI] Đã gửi thông số cảm biến thật: <DATA:31.2,45.6,1200,6.5,...>
```

Và trên LCD: bấm **PB5** phải chuyển vòng 3 trang, bấm **PB7** phải đo lại và gửi
LoRa ngay.

Chưa đạt thì dừng ở đây, xem [Lỗi thường gặp](#lỗi-thường-gặp) — đừng cắm tiếp.

---

## Bước 3 — Chạy backend

```bash
cd backend
npm install
copy .env.example .env      # Windows  (Linux/macOS: cp .env.example .env)
npm start
```

`backend/.env` đã khớp sẵn với firmware, **chạy được ngay không cần sửa**. Trước
khi dùng thật thì nên đổi 3 giá trị:

```ini
DEVICE_API_KEY=<chuỗi bí mật của bạn>     # nếu đổi, phải đổi cả trong sketch ESP32
JWT_SECRET=<chuỗi ngẫu nhiên dài>
SEED_ADMIN_PASSWORD=<mật khẩu admin mới>
```

> `SEED_ADMIN_PASSWORD` chỉ có tác dụng **lần chạy đầu tiên** khi database còn
> trống. Đã chạy rồi thì đổi mật khẩu trong giao diện web.

**Nghiệm thu bước 3** — mở <http://localhost:4000/api/health>, phải thấy `{"ok":true,...}`.

> Muốn có sẵn dữ liệu mẫu cho biểu đồ: chạy `npm run seed` **trước** khi có thiết
> bị thật. Lệnh này **xóa toàn bộ** telemetry nên đừng chạy khi đã đo thật.

---

## Bước 4 — Chạy dashboard

### Cách A — Khi đang chỉnh sửa
```bash
cd frontend
npm install
npm run dev
```

### Cách B — Chạy ổn định lâu dài (khuyến nghị khi đã đo thật)
```bash
cd frontend
npm install
npm run build
npm run preview
```

Script `preview` đã bật sẵn `--host`, nên mở được dashboard từ **điện thoại hoặc
máy khác trong cùng WiFi**: lấy IP máy bằng `ipconfig` (dòng *IPv4 Address*) rồi
vào `http://<IP-đó>:5173`.

Cả hai cách đều tự chuyển tiếp `/api` và `/socket.io` sang backend cổng 4000, nên
**không cần đụng tới CORS** khi backend và dashboard chạy cùng một máy.

**Nghiệm thu bước 4** — đăng nhập `admin` / `admin123`, thấy trang **MENU** với 6 ô.

---

## Bước 5 — Nạp trạm tủ điện (Arduino Nano)

Nạp `firmware/nano_relay/nano_relay.ino`. **Không cần sửa gì.**

Nạp Nano **trước** ESP32, để khi ESP32 gửi lệnh thì đã có bên trả `<ACK>`.

**Nghiệm thu bước 5** — Serial Monitor **9600 baud** hiện:

```
--- NANO 2 (SLAVE): SAN SANG NHAN LORA & TU DIEN ---
```

---

## Bước 6 — Nạp trạm trung tâm (ESP32)

### 6.1 Luồng dữ liệu

- **Đi lên:** STM32 đóng gói 14 thông số thành một chuỗi rồi phát qua LoRa:
  `<DATA:Temp,Hum,EC,pH,N,P,K,D1,D2,D3,D4,Rain,AirTemp,AirHum>`.
  ESP32 nhận, giải mã, chèn thêm `slave_online` + `sensor_status`, đóng thành
  JSON và `POST /api/telemetry`.
- **Đi xuống:** ESP32 hỏi `GET /api/commands/pending?limit=1` mỗi 3 giây, dịch
  `pump3` → `<ON3>`, `van2` → `<ON7>` rồi phát LoRa xuống Nano; Nano trả `<ACK>`
  thì ESP32 mới `POST /api/commands/{id}/ack`.

### 6.2 Sửa đúng 3 dòng

Mở `firmware/esp32_master/esp32_master.ino`, khối cấu hình nằm ngay đầu file:

```cpp
const char* ssid     = "TÊN_WIFI_CỦA_BẠN";
const char* password = "MẬT_KHẨU_WIFI";
const char* BACKEND_BASE = "http://192.168.1.50:4000";   // IP máy chạy backend
```

**Khóa API đã khớp sẵn với `backend/.env`, không phải sửa:**

```cpp
const char* DEVICE_API_KEY = "changeme-esp32-secret";
```

> **Không dùng `localhost`.** Với ESP32, `localhost` là chính con ESP32. Bắt buộc
> điền IP LAN dạng `192.168.x.x`, lấy bằng `ipconfig` trên máy chạy backend.
>
> Muốn chạy hoàn toàn offline (chỉ Nextion + LoRa): đặt `#define ENABLE_WEB_BRIDGE 0`.

### 6.3 Mở cổng tường lửa

PowerShell **quyền Administrator**:

```powershell
New-NetFirewallRule -DisplayName "LoRa backend 4000" -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow
```

**Nghiệm thu bước 6** — Serial của ESP32 (115200) phải hiện lặp lại:

```
WiFi connected: 192.168.1.77
>> [LORA RX] Đất: 31.2C-45.6% | KK: 32.5C-70.0% | Mưa: 15%
  [WEB] POST /telemetry -> 201
```

| Mã | Nghĩa | Xử lý |
|---|---|---|
| `201` | Đã ghi thành công | — |
| `401` | Sai `DEVICE_API_KEY` | So lại giữa sketch và `backend/.env` |
| `-1` | Không nối được backend | Sai IP, khác mạng WiFi, hoặc tường lửa chặn |
| Không có dòng `[LORA RX]` | Chưa nhận được gói từ STM32 | Kiểm tra nguồn, ăng-ten và chiều RX/TX của cả hai module E32 |

---

## Bước 7 — Hiệu chuẩn 4 bồn nước

Đây là bước **bắt buộc** — chưa hiệu chuẩn thì phần trăm mực nước sẽ sai.

Cảm biến đo *khoảng cách từ đầu dò xuống mặt nước*, nên nước càng đầy khoảng cách
càng **nhỏ**. Với mỗi bồn:

1. Khi bồn **cạn**, xem số cm trên dashboard (thẻ *Mực nước các bồn*) → đó là **`Khi cạn (cm)`**.
2. Khi bồn **đầy**, xem số cm tương tự → đó là **`Khi đầy (cm)`**.
3. Vào **SETTINGS → Hiệu chuẩn bồn nước**, điền 2 số đó, đặt tên bồn, bấm **Lưu cài đặt**.

Cột *Đọc hiện tại* hiển thị ngay kết quả quy đổi để đối chiếu — nếu bồn đang đầy
mà báo 8% thì bạn đã điền ngược hai ô.

> Không cần chờ bồn cạn/đầy thật: đo bằng thước từ đầu dò xuống đáy bồn (= khi
> cạn) và xuống mực nước tối đa (= khi đầy) cũng ra kết quả tương đương.
>
> Đổi hiệu chuẩn lúc nào cũng được — phần trăm được tính lúc đọc, nên **dữ liệu
> lịch sử cũng tự sửa theo**.

Cùng trang này, chỉnh luôn **ngưỡng cảnh báo** (pH, EC tính bằng **mS/cm**, nhiệt
độ, độ ẩm) và **thời gian tưới / nghỉ**.

---

## Bước 7b — Phần mềm đã sẵn sàng, phần cứng còn thiếu

| Trên dashboard | Còn thiếu gì |
|---|---|
| **Độ ẩm không khí**, **Nhiệt độ không khí**, **Cảm biến mưa** | ✅ Đã đọc số thật: DHT22 trên `PA0`, board cảm biến mưa đọc ADC trên `PA1` (có lọc trung bình trượt). Chỉ cần đấu dây đúng hai chân đó. |
| **Bơm 2 … Bơm 5** | Đấu đủ relay ở tủ điện. Không đấu relay trực tiếp vào ESP32 — mọi lệnh đi qua trạm Nano bằng LoRa. |

---

## Bước 7c — Dừng khẩn cấp

Nút **DỪNG KHẨN CẤP** trên trang CONTROL không phải để trang trí. Khi bật:

- backend đẩy lệnh TẮT cho **toàn bộ** 5 bơm và 4 van,
- ESP32 phát thêm một lệnh `<ESTOP>` cắt sạch 10 relay ngay lập tức,
- ép hệ thống về chế độ **THỦ CÔNG**,
- **chặn** mọi lệnh BẬT (trả `409`) và chặn chuyển sang TỰ ĐỘNG,
- engine tự động ngừng chạy cho tới khi được giải trừ.

Lệnh TẮT thì luôn được phép — an toàn không bao giờ bị khóa ngoài.

> Đây là chốt chặn ở **phần mềm**. Nó không thay thế nút dừng khẩn cấp cứng nối
> trực tiếp vào nguồn relay. Hệ bơm nước ngoài đồng vẫn nên có một nút cơ khí cắt
> nguồn độc lập với phần mềm.

---

## Bước 8 — Bật điều khiển tự động

1. Đảm bảo trạm **Nano** đã cấp nguồn, đấu đủ relay và nối được LoRa.
2. Trên dashboard vào trang **CONTROL** → chọn **THỦ CÔNG** → bấm bật/tắt thử
   từng thiết bị.
   - Xem Serial của ESP32 có gửi `<ONn>` và nhận `<ACK_ONn>` từ Nano không.
   - Nghe tiếng "tạch" của relay dưới tủ để nghiệm thu đường truyền.
3. Chuyển sang chế độ **TỰ ĐỘNG**.

### ⚠️ Hai bộ não tự động — chỉ dùng một

Hệ thống có **hai** engine tự động, và chúng sẽ giành nhau cùng một relay nếu bật
cả hai:

| Engine | Ở đâu | Đặc điểm |
|---|---|---|
| **ESP32** (`handleAutoIrrigationLogic` + `handleAutoMixingLogic`) | ngay trong sketch | Chạy tại chỗ, **không cần mạng**. Có khóa chéo bồn cạn và trời mưa to, có quy trình pha phân theo EC. **Đây là cái đang dùng.** |
| **Backend** (SETTINGS → *Luật tự động*) | trên máy tính | Linh hoạt hơn, nhưng mất mạng là ngừng. **Mặc định tắt hết — nên để nguyên như vậy.** |

Khi hệ thống ở TỰ ĐỘNG, Nano khóa mọi lệnh tay, và ESP32 báo về backend là lệnh
**thất bại** thay vì báo thành công — nên dashboard sẽ hiện đúng sự thật chứ
không hiện một trạng thái không có thật. Nhưng tốt nhất vẫn là chỉ dùng một bộ não.

---

## ✅ Nghiệm thu toàn tuyến

Trên trang **DASHBOARD**, các thẻ trạng thái phải xanh:

| Thẻ | Xanh nghĩa là |
|---|---|
| **Master** | ESP32 có gọi backend trong 30 giây qua |
| **Slave** | Node STM32 đang sống (có gói LoRa gần đây) |
| **RS485** | Giao dịch Modbus cuối cùng đọc tốt |
| **Realtime** | WebSocket của trình duyệt đang thông |

Và:
- [ ] 4 thẻ hàng trên (Nhiệt độ / Độ ẩm / pH / EC) có số và đổi theo thời gian
- [ ] Thẻ **Kali & Đạm** có 2 số, đơn vị ppm
- [ ] 3 thẻ không khí / mưa có số (sau khi làm xong bước 7b)
- [ ] Panel **Mực nước các bồn** đúng % so với bồn thật
- [ ] Trang **CONTROL** bật/tắt được bơm và van khi ở THỦ CÔNG
- [ ] Bấm **DỪNG KHẨN CẤP** → mọi relay nhả, thử bật lại bị từ chối

---

## Hệ thống tự xử lý những gì

Biết trước để khỏi hoảng khi gặp:

| Tình huống | Hệ thống làm gì |
|---|---|
| ESP32 mất điện đúng lúc vừa nhận lệnh | Lệnh không được xác nhận sẽ **tự phát lại** sau 30 giây. Thử 3 lần không xong thì đánh dấu `failed` và **giải phóng thiết bị** |
| ESP32 offline lâu, trong lúc đó bạn bấm nút nhiều lần | Lệnh cũ quá 5 phút bị hủy; mỗi thiết bị chỉ giữ **1 lệnh mới nhất**, nên không phát lại cả chuỗi thao tác cũ |
| ESP32 chết hẳn | Sau 30 giây, thẻ **Master** tự chuyển đỏ và có cảnh báo — không cần bấm F5 |
| Mất WiFi ở máy tính rồi có lại | Dashboard tự tải lại toàn bộ, không hiển thị số liệu cũ |
| Đầu dò RS485 chưa đọc được lần nào | ESP32 gửi `sensor_status: TIMEOUT` và bỏ trống 7 chỉ số đất. Dashboard hiện `--` thay vì pH = 0, không bắn cảnh báo giả |
| Một chỉ số nằm ngoài ngưỡng liên tục | Chỉ cảnh báo **1 lần**, im 10 phút rồi mới nhắc lại |

Các mốc thời gian chỉnh trong `backend/.env`: `COMMAND_RETRY_SECONDS`,
`COMMAND_TTL_SECONDS`, `MASTER_TIMEOUT_SECONDS`, `ALERT_REPEAT_SECONDS`.

---

## Lỗi thường gặp

### Thẻ RS485 không xanh

Firmware báo về đúng nguyên nhân, đọc chữ trên thẻ:

| Hiện | Nghĩa | Kiểm tra |
|---|---|---|
| **Không phản hồi — kiểm tra dây** | Đầu dò im lặng hoàn toàn | Nguồn đầu dò (thường 12 V, không phải 5 V); đảo thử 2 dây **A/B**; địa chỉ Modbus phải là **0x02** |
| **Sai CRC — nhiễu đường truyền** | Có dữ liệu nhưng sai | Gắn trở **120 Ω** hai đầu bus; dùng đôi xoắn; tách xa dây động lực bơm; nối chung GND giữa STM32 và module RS485 |
| **Nhận thiếu byte** | Khung đứt giữa chừng | Sai baud (đầu dò phải ở **9600 8N1**); hoặc module RS485 đảo chiều chậm |
| **Sai header Modbus** | Trả lời từ thiết bị khác | Trên bus có nhiều thiết bị trùng địa chỉ — chỉ để 1 đầu dò |

**Nếu module RS485 của bạn có chân DE/RE rời:** firmware không lái chân này. Phải
**đổi sang module tự động đảo chiều**, hoặc thêm vào `main.cpp` một chân GPIO bật
DE trước `RS485_Serial.write()` và tắt sau `RS485_Serial.flush()`.

### Hai trạm LoRa không nói chuyện được

- **Chiều RX/TX** — lỗi phổ biến nhất. RX của board phải nối **TXD** của module,
  TX nối **RXD**. Xem lại bảng ở Bước 1.
- **GND chung** giữa vi điều khiển và module LoRa.
- **M0/M1 phải ở mức LOW** (chế độ Normal). Cả ba trạm phải cùng **kênh và địa chỉ**.
- **Nguồn** — E32 hút dòng cao lúc phát; nguồn yếu sẽ làm module reset giữa chừng.
- **Ăng-ten** — đừng cấp nguồn khi chưa gắn ăng-ten.

### Một bồn báo "Mất tín hiệu"

Firmware trả `-1` khi không nhận được sóng dội trong 25 ms (tương đương > 4 m):

- Mặt nước quá xa (>4 m) hoặc bồn quá sâu
- Cảm biến lắp nghiêng → phải chiếu **vuông góc** mặt nước
- Mặt nước gợn mạnh do bơm đang xả → lắp lệch khỏi dòng chảy
- Nhiễu chéo giữa 4 cảm biến (xem cảnh báo ở Bước 1)
- Thiếu dòng: 4 cảm biến cùng phát tốn dòng, thử nguồn 5 V khỏe hơn

### Bấm nút trên web không có gì xảy ra

Hệ thống đang ở **TỰ ĐỘNG** — Nano khóa mọi lệnh tay. Chuyển sang **THỦ CÔNG**.

### Web hiện bơm ON nhưng thực tế không chạy

Xem trang **Cảnh báo**. Nếu có "lệnh không được xác nhận sau 3 lần thử" thì đường
LoRa từ ESP32 xuống Nano đang đứt.

### Mở được localhost:5173 nhưng điện thoại không vào được

- Phải chạy frontend bằng `npm run preview` (đã bật sẵn `--host`)
- Điện thoại và PC phải cùng WiFi
- Mở thêm cổng 5173 trên tường lửa

### Số EC trông lạ

Dashboard hiển thị **mS/cm** theo đúng thiết kế, nhưng hệ thống **lưu µS/cm** như
đầu dò trả về. Trang SETTINGS ghi rõ giá trị quy đổi ngay dưới ô nhập.
`1200 µS/cm = 1.2 mS/cm`.

### Hôm qua chạy được, hôm nay không

Kiểm tra **IP máy chạy backend** trước tiên — router có thể đã cấp IP khác. Cách
chắc chắn: vào router đặt IP tĩnh (DHCP reservation) cho máy đó.

---

## Chạy nền lâu dài trên Windows

Đóng cửa sổ terminal là backend tắt. Để nó tự chạy nền và tự bật lại sau khi khởi
động máy:

```bash
npm install -g pm2 pm2-windows-startup
pm2-startup install

cd backend
pm2 start src/index.js --name farm-backend

cd ../frontend
npm run build
pm2 start npm --name farm-web -- run preview

pm2 save
```

Lệnh hữu ích: `pm2 list`, `pm2 logs farm-backend`, `pm2 restart farm-backend`.

---

## Vận hành

**Nhịp dữ liệu.** STM32 phát LoRa **mỗi 2 phút** (`LORA_SEND_INTERVAL` trong
`main.cpp`), nên dashboard cập nhật theo nhịp đó. Bấm **PB7** để ép gửi ngay. Thẻ
**Master** vẫn xanh liên tục vì ESP32 hỏi lệnh mỗi 3 giây.

**Dung lượng.** Backend **tự xóa** telemetry cũ hơn 90 ngày và cảnh báo cũ hơn 30
ngày (`TELEMETRY_RETENTION_DAYS` / `ALERT_RETENTION_DAYS`, đặt `0` để giữ mãi).

**Sao lưu.** Toàn bộ dữ liệu nằm trong `backend/data/`. Tắt backend rồi copy cả
thư mục (nhớ cả file `.db-wal` và `.db-shm`).

**Bảo mật.** `DEVICE_API_KEY` đi qua HTTP dạng thô và nằm công khai trong mã
nguồn. Chấp nhận được trong mạng LAN phòng lab; nếu mở ra Internet thì phải đổi
khóa ở **cả hai phía**, đổi `JWT_SECRET`, đổi mật khẩu admin và đặt sau reverse
proxy có HTTPS.

---

## Phụ lục — Ánh xạ thiết bị

| Dashboard | Lệnh LoRa | Relay Nano | Chân |
|---|---|---|---|
| `pump1` … `pump5` (Bơm 1–5) | `<ON1>` … `<ON5>` | 1–5 | A1, A0, D2, D3, D4 |
| `van1` … `van4` (Van 1–4) | `<ON6>` … `<ON9>` | 6–9 | D5, D6, D7, D8 |
| (đèn báo AUTO) | — | 10 | D9 |
| Đổi chế độ | `<SET_MODE=AUTO\|MANUAL>` | — | — |
| Dừng khẩn cấp | `<ESTOP>` | tất cả | — |

> Id cũ `pump` vẫn được backend chấp nhận và tự quy về `pump1`, nên ESP32 đang
> chạy ngoài hiện trường không cần nạp lại ngay.

---

## Ánh xạ 4 bồn — đã chốt theo dây thật

Nhóm phần cứng đã xác nhận thứ tự này. Backend và dashboard đã đặt tên theo đúng đây:

| Cảm biến | Chân STM32 | Biến | Bồn |
|---|---|---|---|
| Siêu âm 1 | `PB13` (ECHO1) | `Dist1` | **Bồn Đạm** |
| Siêu âm 2 | `PB14` (ECHO2) | `Dist2` | **Bồn Kali** |
| Siêu âm 3 | `PB15` (ECHO3) | `Dist3` | **Bồn Nước** |
| Siêu âm 4 | `PA8` (ECHO4) | `Dist4` | **Bồn Trộn** |

Nếu sau này dời đầu dò sang chân khác, chỉ cần **đổi tên trong SETTINGS →
Hiệu chuẩn bồn nước**, không phải sửa code.

### ⚠️ Hệ quả: logic AUTO trong ESP32 đang dùng nhầm hai biến

Với ánh xạ đã chốt ở trên, hai chỗ trong `firmware/esp32_master/esp32_master.ino`
đang tham chiếu **ngược nhau**:

| Dòng code hiện tại | Ý định | Với ánh xạ đã chốt thì nó đang đọc |
|---|---|---|
| `if (Dist3 > 50.0)` → bật Bơm 3 hút nước vào bồn trộn | mức **bồn Trộn** | ❌ mức **bồn Nước** |
| `isTankEmpty = (Dist4 > 80)` → khóa an toàn "bồn cạn" | mức **bồn Nước** | ❌ mức **bồn Trộn** |

Hậu quả nếu để nguyên: bơm châm nước vào bồn trộn sẽ dừng/chạy theo mực nước của
**bồn nguồn** thay vì bồn trộn, và khóa an toàn "hết nước" sẽ kích hoạt theo mực
**bồn trộn**.

**Sửa bằng cách đổi chỗ hai biến** trong hai hàm `handleAutoMixingLogic()` và
`handleAutoIrrigationLogic()`: dùng `Dist4` cho bồn trộn, `Dist3` cho bồn nước.

> Tôi **chưa tự sửa** phần này vì nó là logic điều khiển bơm thật — nên do người
> nắm sa bàn quyết định và thử tay trước khi chạy AUTO. Chạy ở chế độ **THỦ CÔNG**
> thì không ảnh hưởng gì.

---

📄 Xem thêm: [HUONG-DAN-TRIEN-KHAI.docx](HUONG-DAN-TRIEN-KHAI.docx) (bản Word,
bảng tra biến cấu hình theo từng máy).
