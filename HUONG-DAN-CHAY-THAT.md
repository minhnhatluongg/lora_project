# 🔌 Hướng dẫn đưa hệ thống chạy thật với thiết bị đo

Tài liệu này đi từ "máy tính chỉ có code" đến "dashboard hiển thị số đo thật từ
ngoài đồng". Làm tuần tự từ trên xuống — **mỗi bước đều có mốc nghiệm thu**, đừng
sang bước sau khi bước trước chưa đạt, vì càng về sau càng khó biết lỗi nằm ở đâu.

Sơ đồ toàn tuyến:

```
Đầu dò đất RS485 ──Modbus 9600──┐
                                 ├─► STM32F411 ──UART2 115200 (JSON)──► ESP32 ──WiFi──► Backend :4000 ──► Dashboard :5173
4 × HC-SR04 ────────────────────┘        │
                                      LCD 1602
```

---

## 0. Chuẩn bị

### Phần cứng
- [ ] Board **STM32F411CE (BlackPill)** + mạch nạp **ST-Link V2**
- [ ] **ESP32** (DevKit v1 hoặc tương đương) + cáp USB
- [ ] Đầu dò đất **RS485 7-in-1** (T/H/EC/pH/N/P/K) — thường cần nguồn **9–24 V**
- [ ] Module **TTL ↔ RS485**. Firmware hiện tại **không điều khiển chân DE/RE**,
      nên phải dùng loại **tự động đảo chiều** (auto flow control, vd. dùng chip
      MAX13487 hoặc mạch có sẵn transistor lái DE). Nếu module của bạn có chân
      DE/RE rời thì phải nối cứng hoặc sửa firmware — xem mục Lỗi thường gặp.
- [ ] **4 × HC-SR04** + dây
- [ ] **LCD 1602 I2C** (địa chỉ 0x27)
- [ ] 2 nút nhấn + **2 điện trở kéo lên 10 kΩ** (firmware dùng `INPUT`, *không*
      dùng `INPUT_PULLUP`, nên bắt buộc có trở kéo lên ngoài)
- [ ] Nguồn 5 V đủ khỏe (4 cảm biến siêu âm + LCD ăn khá dòng)
- [ ] Điện trở **120 Ω** cho hai đầu bus RS485 nếu dây dài trên ~10 m

### Phần mềm trên PC
- [ ] **Node.js 18+** — `node -v`
- [ ] **PlatformIO**: cài extension *PlatformIO IDE* trong VS Code (tự tải toolchain
      STM32 lần đầu, khoảng vài trăm MB)
- [ ] **Arduino IDE** (hoặc PlatformIO) có board ESP32 + thư viện **ArduinoJson v6**

---

## Bước 1 — Đấu dây

### 1.1 STM32F411CE

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
| | **PB7** | nút đo ngay (qua trở kéo lên 10 kΩ về 3V3) |
| **Lên ESP32** | **PA2** (TX2) | → ESP32 **GPIO16** |
| | **PA3** (RX2) | ← ESP32 **GPIO17** |

### 1.2 ESP32
- `GPIO16` ← PA2, `GPIO17` → PA3
- **GND của ESP32 phải nối chung GND với STM32** — thiếu dây này là lỗi phổ biến
  nhất, UART sẽ ra rác hoặc không có gì.
- Cả hai đều mức 3.3 V nên nối thẳng, không cần chuyển mức.

### ⚠ Ba điểm dễ hỏng phần cứng

1. **Chân Echo của HC-SR04 xuất 5 V.** Đa số chân digital của F411 chịu được 5 V
   (chân FT), nhưng hãy tra datasheet đúng chân bạn dùng. An toàn nhất: mỗi Echo
   qua cầu chia áp 1 kΩ / 2 kΩ xuống ~3.3 V.
2. **HC-SR04 cần VCC 5 V** mới hoạt động ổn định. Trig nhận mức 3.3 V từ STM32
   vẫn kích được, nên chỉ cần cấp 5 V cho VCC.
3. **4 cảm biến dùng chung chân Trig** → cả 4 phát sóng cùng lúc mỗi lần đo, dù
   firmware chỉ đọc lần lượt từng Echo. Hệ quả: sóng của cảm biến này có thể lọt
   vào cảm biến kia. Khi lắp, **hướng 4 cảm biến ra 4 phía khác nhau, tránh cho
   chúng nhìn thấy nhau hoặc nhìn vào cùng một mặt phản xạ.**

---

## Bước 2 — Nạp firmware STM32 và đo thử tại chỗ

```bash
cd testcode
pio run                 # biên dịch — chạy lần này TRƯỚC khi nạp
pio run -t upload       # nạp qua ST-Link
pio device monitor      # xem log, 115200 baud
```

> Nếu chưa quen CLI: mở thư mục `testcode` bằng VS Code có PlatformIO, rồi bấm
> nút **✓** (Build) và **→** (Upload) ở thanh dưới.

**Nghiệm thu bước 2** — trên Serial monitor phải thấy lặp lại mỗi ~2.5 giây:

```
Do am dat: 45.6 %
Nhiet do:  31.2 °C
EC:        1200 us/cm
pH:        6.5
Nito (N):  118 mg/kg
...
--- SIÊU ÂM (cm) ---
D1: 42.5 | D2: 88.0 | D3: 31.2 | D4: 35.0
```

Và trên LCD: bấm nút **PB5** phải chuyển vòng 3 trang (T/H/EC/pH → NPK → D1..D4),
bấm **PB7** phải đo lại ngay lập tức.

Chưa đạt thì dừng lại ở đây, xem [Lỗi thường gặp](#lỗi-thường-gặp) — đừng cắm ESP32 vội.

---

## Bước 3 — Chạy backend

```bash
cd backend
npm install
copy .env.example .env      # Windows  (Linux/macOS: cp .env.example .env)
```

Mở `backend/.env` và **đổi 3 giá trị này trước khi dùng thật**:

```ini
DEVICE_API_KEY=<chuỗi bí mật của bạn>     # ESP32 phải gửi đúng chuỗi này
JWT_SECRET=<chuỗi ngẫu nhiên dài>
SEED_ADMIN_PASSWORD=<mật khẩu admin mới>
```

> `SEED_ADMIN_PASSWORD` chỉ có tác dụng **lần chạy đầu tiên** khi database còn
> trống. Nếu bạn đã chạy thử trước đó, đổi mật khẩu trong giao diện web thay vì
> sửa file này.

Chạy:

```bash
npm start
```

**Nghiệm thu bước 3** — mở trình duyệt vào <http://localhost:4000/api/health>,
phải thấy `{"ok":true,...}`.

> **Lưu ý dữ liệu cũ:** nếu trước đây bạn đã chạy simulator, database đang có dữ
> liệu giả. Muốn bắt đầu sạch: tắt backend, xóa thư mục `backend/data/`, chạy lại.
> Đừng chạy `npm run seed` khi đã có thiết bị thật — lệnh đó **xóa toàn bộ**
> telemetry rồi nạp dữ liệu mẫu.

---

## Bước 4 — Chạy frontend

### Cách A — Đơn giản nhất (dùng khi đang chỉnh sửa)

```bash
cd frontend
npm install
npm run dev
```

Mở <http://localhost:5173>, đăng nhập bằng tài khoản admin.

### Cách B — Chạy ổn định lâu dài (khuyến nghị khi đã đo thật)

```bash
cd frontend
npm run build
npm run preview
```

Bản build nhẹ và nhanh hơn nhiều. Script `preview` đã bật sẵn `--host` nên bạn mở
được dashboard từ **điện thoại hoặc máy khác trong cùng WiFi**: lấy IP máy bằng
`ipconfig` (dòng *IPv4 Address*, vd. `192.168.1.50`) rồi vào
`http://192.168.1.50:5173`.

Cả hai cách đều tự chuyển tiếp `/api` và `/socket.io` sang backend ở cổng 4000,
nên **không cần đụng tới CORS**.

**Nghiệm thu bước 4** — đăng nhập được, dashboard hiện ra (số liệu còn trống hoặc
là dữ liệu cũ — bình thường, vì ESP32 chưa gửi gì).

---

## Bước 5 — Nạp ESP32

Mở `esp32_master_example.ino`, sửa 4 dòng đầu:

```cpp
const char* WIFI_SSID = "tên WiFi của bạn";
const char* WIFI_PASS = "mật khẩu WiFi";
const char* BASE   = "http://192.168.1.50:4000";   // IP máy chạy backend, KHÔNG dùng localhost
const char* APIKEY = "<đúng DEVICE_API_KEY trong .env>";
```

> `localhost` trên ESP32 nghĩa là *chính con ESP32*, không phải máy tính của bạn.
> Bắt buộc điền IP LAN.

**Mở cổng 4000 trên tường lửa Windows** (chạy PowerShell **quyền Administrator**):

```powershell
New-NetFirewallRule -DisplayName "LoRa backend 4000" -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow
```

Nạp sketch, mở Serial monitor ESP32 (115200).

**Nghiệm thu bước 5** — Serial của ESP32 phải hiện lặp lại:

```
WiFi connected: 192.168.1.77
POST /telemetry -> 201
POST /telemetry -> 201
```

`201` là đã ghi thành công. Ý nghĩa các mã khác:

| Mã | Nghĩa | Xử lý |
|---|---|---|
| `401` | Sai `DEVICE_API_KEY` | So lại `APIKEY` với `backend/.env` |
| `-1` | Không nối được tới backend | Sai IP, tường lửa chặn, hoặc khác mạng WiFi |
| Không in gì | Không nhận được UART từ STM32 | Kiểm tra PA2→GPIO16, PA3→GPIO17, **GND chung** |

---

## Bước 6 — Hiệu chuẩn 4 bồn nước

Đây là bước **bắt buộc** — chưa hiệu chuẩn thì phần trăm mực nước sẽ sai.

Cảm biến đo *khoảng cách từ đầu dò xuống mặt nước*, nên nước càng đầy khoảng cách
càng **nhỏ**. Với mỗi bồn:

1. Khi bồn **cạn**, xem số cm hiện trên dashboard (mục *Mực nước bồn* → dòng
   "Khoảng cách") → đó là **`Khi cạn (cm)`**.
2. Khi bồn **đầy**, xem số cm tương tự → đó là **`Khi đầy (cm)`**.
3. Vào **Cài đặt & Tự động → Hiệu chuẩn bồn nước**, điền 2 số đó, đặt tên bồn,
   rồi bấm **Lưu thay đổi**.

Cột *Đọc hiện tại* hiển thị ngay kết quả quy đổi để bạn đối chiếu — nếu bồn đang
đầy mà nó báo 8% thì bạn đã điền ngược 2 ô.

> Không cần chờ bồn cạn/đầy thật: đo bằng thước từ đầu dò xuống đáy bồn (= khi cạn)
> và xuống mực nước tối đa (= khi đầy) cũng ra kết quả tương đương.

Đổi hiệu chuẩn lúc nào cũng được — phần trăm được tính lúc đọc, nên **dữ liệu lịch
sử cũng tự sửa theo**.

Cùng trang này, chỉnh luôn **Ngưỡng cảnh báo** cho đúng loại cây trồng của bạn
(pH, EC tính bằng **µS/cm**, N/P/K tính bằng mg/kg, mức nước cạn tính bằng %).

---

## Bước 7 — Bật điều khiển tự động (nếu có đấu relay)

1. Đấu relay bơm/van vào ESP32, rồi hiện thực hàm `driveRelay()` trong
   `esp32_master_example.ino` (chỗ đang để comment trong `pollCommands()`).
2. Trên dashboard, phần **Điều khiển thiết bị** → chọn **MANUAL** → bấm bật/tắt
   từng thiết bị để kiểm tra relay đóng cắt đúng.
3. Vào **Cài đặt & Tự động → Luật tự động**, đặt điều kiện, vd:
   - `Bơm nước` BẬT khi `Độ ẩm đất` < `40` %
   - `Van 1` BẬT khi `Mực nước bồn 1` < `20` %
4. Tick **Bật luật**, Lưu, rồi chuyển dashboard về chế độ **AUTO**.

Mỗi lần luật kích hoạt sẽ có một dòng trong **Cảnh báo gần nhất** dạng
`AUTO: van1 → ON (humidity 38 below 40)` để bạn kiểm chứng.

---

## ✅ Nghiệm thu toàn tuyến

Trên dashboard, 4 thẻ trạng thái ở góc trên phải **đều phải xanh**:

| Thẻ | Xanh nghĩa là |
|---|---|
| **Master** | ESP32 có gửi dữ liệu trong 30 giây qua |
| **Slave** | Node STM32 đang sống |
| **RS485** | Giao dịch Modbus cuối cùng đọc tốt |
| **Realtime** | WebSocket của trình duyệt đang thông |

Và:
- [ ] 4 thẻ số (Nhiệt độ / Độ ẩm / pH / EC) đổi số theo thời gian thực
- [ ] Panel **Mực nước bồn** hiện đúng % so với bồn thật
- [ ] Panel **NPK** có 3 thanh
- [ ] Dòng chữ dưới tiêu đề ghi "dữ liệu vài giây trước"
- [ ] Biểu đồ có đường vẽ khi chọn mốc **1 giờ**

---

## Lỗi thường gặp

### Dashboard: thẻ RS485 không xanh

Firmware báo về đúng nguyên nhân, đọc chữ trên thẻ:

| Hiện | Nghĩa | Kiểm tra |
|---|---|---|
| **Không phản hồi — kiểm tra dây** | Đầu dò im lặng hoàn toàn | Nguồn đầu dò (thường 12 V, không phải 5 V); đảo thử 2 dây **A/B**; địa chỉ Modbus của đầu dò phải là **0x02** (firmware đang hỏi ID 2) |
| **Sai CRC — nhiễu đường truyền** | Có dữ liệu nhưng sai | Gắn trở **120 Ω** hai đầu bus; dây A/B nên là đôi xoắn; tách xa dây động lực bơm; nối chung GND giữa STM32 và module RS485 |
| **Nhận thiếu byte** | Khung dữ liệu đứt giữa chừng | Sai baud (đầu dò phải ở **9600 8N1**); hoặc module RS485 đảo chiều chậm — xem mục dưới |
| **Sai header Modbus** | Trả lời từ thiết bị khác | Trên bus có nhiều thiết bị trùng địa chỉ — tháo bớt, chỉ để 1 đầu dò |

**Nếu module RS485 của bạn có chân DE/RE rời:** firmware không lái chân này. Cách
nhanh: nối `DE` và `RE` chung rồi kéo về mức phát/thu bằng tay sẽ không chạy được
hai chiều — bạn cần **đổi sang module tự động đảo chiều**, hoặc thêm vào
`main.cpp` một chân GPIO bật DE trước `RS485_Serial.write()` và tắt sau
`RS485_Serial.flush()`.

### Một bồn báo "Mất tín hiệu"

Firmware trả `-1` khi không nhận được sóng dội trong 25 ms (tương đương > 4 m):

- Mặt nước quá xa (>4 m) hoặc bồn quá sâu → HC-SR04 không với tới
- Cảm biến lắp nghiêng → sóng dội đi chỗ khác, phải chiếu **vuông góc** mặt nước
- Mặt nước gợn mạnh do bơm đang xả → lắp lệch khỏi dòng chảy
- Nhiễu chéo giữa 4 cảm biến (xem cảnh báo ở Bước 1)
- Thiếu dòng: 4 cảm biến cùng phát tốn dòng, thử nguồn 5 V khỏe hơn

### Thẻ Master đỏ nhưng ESP32 vẫn in `POST -> 201`

Đồng hồ máy tính bị sai giờ, hoặc backend vừa khởi động lại. Chờ một chu kỳ.

### Mở được `localhost:5173` nhưng điện thoại không vào được

- Phải chạy frontend kèm `--host` (Cách B ở Bước 4)
- Điện thoại và PC phải cùng WiFi
- Mở thêm cổng 5173 trên tường lửa, tương tự lệnh ở Bước 5

### Số EC trông lạ

Hệ thống dùng **µS/cm** — đúng giá trị thô đầu dò trả về. `1200 µS/cm = 1.2 mS/cm`.
Nếu tài liệu đầu dò của bạn ghi mS/cm thì nhân 1000 khi đặt ngưỡng.

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

**Dung lượng dữ liệu.** STM32 gửi khoảng **1 bản ghi mỗi 2.5 giây** → ~35.000
dòng/ngày, ~1 triệu dòng/tháng (khoảng 100 MB). SQLite chịu được, nhưng nếu bạn
định chạy nhiều tháng thì nên giãn nhịp đo: trong `testcode/src/main.cpp`, tìm
dòng cuối `while (millis() - waitStart < 2000)` và tăng `2000` lên `30000`
(30 giây/lần) — nút PB7 vẫn cho phép đo ngay bất cứ lúc nào.

**Sao lưu.** Toàn bộ dữ liệu nằm trong `backend/data/`. Tắt backend rồi copy cả
thư mục là xong (nhớ copy cả file `.db-wal` và `.db-shm`).

**Bảo mật.** `DEVICE_API_KEY` đi qua HTTP dạng thô. Trong mạng LAN riêng thì chấp
nhận được; nếu mở ra Internet thì phải đặt sau reverse proxy có HTTPS.
