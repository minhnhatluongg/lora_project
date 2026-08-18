# ⚠️ LƯU Ý KHI CHẠY TRÊN MÁY KHÁC

File này gom những chỗ **hay vấp nhất** khi đem source sang máy mới. Đọc mục 1
trước — 90% người mở project ra là gặp ngay.

---

## 1. Dấu gạch đỏ `could not open source file "HardwareSerial.h"` — KHÔNG PHẢI LỖI

Khi mở `firmware/esp32_master/esp32_master.ino` bằng **VSCode**, tab PROBLEMS sẽ
báo đỏ:

```
#include errors detected. Please update your includePath.
Squiggles are disabled for this translation unit.
could not open source file "HardwareSerial.h"  C/C++(1696)
```

**Cứ kệ nó. Code không hề sai.**

Đây là extension **C/C++ của Microsoft** trong VSCode, nó cố đọc file `.ino` như
C++ thường. Nhưng `HardwareSerial.h`, `WiFi.h`, `Preferences.h`… chỉ tồn tại bên
trong **core ESP32 của Arduino**, nằm ở một chỗ VSCode không biết đường tới.

Bằng chứng nằm ngay trong chính thông báo đó: *"Squiggles are disabled for this
translation unit"* — nó **tự thừa nhận là chỉ tô đỏ cho vui, không kiểm tra gì cả**.

### Làm sao cho đúng

**File `.ino` phải mở bằng Arduino IDE để Verify và Upload — không phải VSCode.**

1. Mở **Arduino IDE**
2. `File → Open` → chọn `firmware/esp32_master/esp32_master.ino`
3. `Tools → Board` → **ESP32S3 Dev Module**
4. `Tools → Port` → chọn cổng COM của board
5. Cài 3 thư viện trong `Tools → Manage Libraries`: **Adafruit GFX**, **Adafruit SSD1306**, **ArduinoJson**
6. Bấm **Verify (✓)** → phải xanh, không lỗi
7. Bấm **Upload (→)**

Mở bằng Arduino IDE thì **không có dấu đỏ nào cả**. Dùng VSCode chỉ để xem/sửa
chữ thôi, còn nạp chip thì sang Arduino IDE.

> Ba board dùng ba công cụ khác nhau:
> `esp32_master/` và `nano_relay/` → **Arduino IDE**;
> `stm32_sensor_node/` → **Arduino IDE** (core STM32duino **2.7.1**, không phải 3.x)
> hoặc PlatformIO — cùng một file `.ino`.

---

## 2. Lý do THẬT khiến ESP32 không connect được

Trong `firmware/esp32_master/esp32_master.ino`, ngay đầu file có khối cấu hình.
**Mặc định nó đang là WiFi của máy người viết code, sang máy khác chắc chắn không
vào được.**

```cpp
// --- 1. WiFi mà CẢ ESP32 và MÁY CHẠY BACKEND cùng nối vào ---
const char* ssid     = "DESKTOP-2GO7JB8 5238";   // ← ĐỔI
const char* password = "78U5%g77kkkkk";           // ← ĐỔI

// --- 2. Địa chỉ máy chạy backend (KHÔNG dùng "localhost") ---
const char* BACKEND_BASE = "http://192.168.1.50:4000";   // ← ĐỔI

// --- 3. Khóa API — ĐÃ KHỚP SẴN, KHÔNG SỬA ---
const char* DEVICE_API_KEY = "changeme-esp32-secret";
```

Chỉ sửa **3 dòng**, dòng 4 giữ nguyên.

### Lấy IP backend thế nào

Trên **máy đang chạy backend** (không phải máy nào khác), mở CMD gõ:

```
ipconfig
```

Tìm dòng **IPv4 Address**, ví dụ `192.168.1.27` → điền
`BACKEND_BASE = "http://192.168.1.27:4000"`.

### Ba điều bắt buộc

- ❌ **Không dùng `localhost`** — với ESP32, `localhost` là chính con ESP32.
- ✅ **ESP32 và máy chạy backend phải cùng một mạng WiFi.** Khác mạng là hỏng.
- ✅ **Mở cổng 4000 trên Windows Firewall** của máy chạy backend, nếu không
  ESP32 gọi vào sẽ bị chặn im lặng.

> IP máy tính thường **đổi sau mỗi lần khởi động router**. Nếu hôm nay chạy được
> mai lại mất, việc đầu tiên là `ipconfig` lại xem IP có đổi không.

---

## 3. Đừng để project trong OneDrive hoặc thư mục có dấu tiếng Việt

Đường dẫn kiểu này **rất dễ sinh lỗi lạ**:

```
C:\Users\ASUS\OneDrive\Máy tính\lora_project\
        └──────┬──────┘ └───┬───┘
          OneDrive      có dấu
```

- **OneDrive** vừa build vừa đồng bộ → `node_modules` hay bị khóa file, `npm install` lỗi nửa chừng.
- **Chữ có dấu / khoảng trắng** trong đường dẫn → Arduino IDE và PlatformIO thỉnh
  thoảng biên dịch hỏng với thông báo khó hiểu.

**Chuyển project ra chỗ đơn giản:** `C:\lora_project`

---

## 4. Chạy phần mềm — clone về là chạy, không cần xin file gì

`node_modules/` không nằm trong git nên **bắt buộc phải `npm install`** cho cả
hai bên. Ngoài ra không cần ai gửi file gì cả.

**Terminal 1 — Backend:**

```
git clone https://github.com/minhnhatluongg/lora_project.git C:\lora_project
cd C:\lora_project\backend
npm install
copy .env.example .env
npm start
```

**Terminal 2 — Dashboard** (mở terminal mới, để terminal 1 chạy tiếp):

```
cd C:\lora_project\frontend
npm install
npm run build
npm run preview
```

Mở trình duyệt `http://localhost:5173`, đăng nhập:

| | |
|---|---|
| Tài khoản | `admin` |
| Mật khẩu | `admin123` |

**Chỉ cần cài Node.js 18 trở lên.** Không phải cài Python, không phải cài
Visual Studio Build Tools — `better-sqlite3` tự tải sẵn bản biên dịch.

> ⚠️ **Không cần ai gửi file `.env`.** File `.env.example` trong repo đã đầy đủ
> hơn, cứ `copy .env.example .env` là xong. Khóa API trong đó đã khớp sẵn với
> firmware ESP32.

Dashboard chạy được ngay cả khi **chưa cắm phần cứng** — chỉ là chưa có số liệu.

---

### Lỗi `ECONNREFUSED ::1:4000` — quên chạy backend

Nếu terminal chạy frontend in ra:

```
[vite] ws proxy error:
Error: connect ECONNREFUSED ::1:4000
```

Nghĩa là **frontend chạy rồi nhưng backend chưa chạy** — không có ai đứng ở cổng 4000.

**Backend và frontend là hai tiến trình riêng, phải mở HAI terminal.** Terminal
chạy backend phải **để nguyên đó**, đóng là backend chết theo.

Mở terminal thứ hai (nút `+` góc phải panel TERMINAL của VSCode), chạy phần
backend ở trên. Chạy đúng thì in ra:

```
🌱 LoRa farm backend running on http://localhost:4000
   Socket.IO + REST API ready
```

Lỗi bên terminal frontend sẽ **tự hết**, không cần khởi động lại `npm run dev`.

Kiểm tra chắc chắn: mở `http://localhost:4000/api/health`, thấy `{"ok":true,...}` là sống.

| Backend báo lỗi | Nguyên nhân |
|---|---|
| `EADDRINUSE` | Cổng 4000 đã bị chương trình khác chiếm |
| `Cannot find module` | Quên `npm install` trong thư mục `backend` |
| Lỗi `better-sqlite3` | Xóa `backend/node_modules` rồi `npm install` lại — thường do OneDrive khóa file |

> **`npm install` phải chạy HAI lần** — một lần trong `backend/`, một lần trong
> `frontend/`. Rất nhiều người chỉ chạy ở `frontend/` rồi tưởng đã xong.

---

## 5. Kiểm tra ESP32 nối được chưa

Sau khi Upload, trong Arduino IDE mở **Tools → Serial Monitor**, chọn **115200 baud**.

| Serial Monitor in ra | Nghĩa là | Xử lý |
|---|---|---|
| Báo có địa chỉ IP | ✅ WiFi ổn | — |
| Quay mãi, không ra IP | Sai tên hoặc mật khẩu WiFi | Xem lại dòng `ssid` / `password` |
| `POST /telemetry -> 201` | ✅ Thông suốt tới backend | — |
| `POST /telemetry -> -1` | Không với tới backend | Sai IP, khác mạng WiFi, hoặc firewall chặn cổng 4000 |
| `-> 401` | Khóa API hai bên lệch | `DEVICE_API_KEY` trong sketch phải bằng trong `backend/.env` |

Màn **OLED** trên ESP32 cũng hiện `WiFi Offline` nếu chưa vào được mạng.

> ESP32 hỏi lệnh mỗi **3 giây**, nhưng STM32 chỉ gửi số đo qua LoRa **mỗi 2 phút**.
> Nên thẻ **Master** xanh gần như ngay, còn số liệu cảm biến phải **chờ tới 2 phút**
> mới thấy. Muốn thấy ngay thì bấm nút **PB7** trên STM32 để ép đo và gửi liền.

---

## 6. Hai lỗi cũ nay đã được sửa

Ghi lại để ai đọc tài liệu cũ không đi sửa ngược lại cái đang đúng.

### a. ✅ Ánh xạ bồn đã đúng

Trước đây `handleAutoMixingLogic()` và `handleAutoIrrigationLogic()` dùng ngược
`Dist3` ↔ `Dist4`. Nhóm phần cứng đã sửa; ánh xạ hiện tại khớp dây thật:

| Chân STM32 | Biến | Bồn |
|---|---|---|
| `PB13` | `Dist1` | Đạm |
| `PB14` | `Dist2` | Kali |
| `PB15` | `Dist3` | **Nước** |
| `PA8` | `Dist4` | **Trộn** |

---

### b. ✅ Cảm biến không khí và mưa đã là số thật

Bản firmware mới đọc DHT22 trên `PA0` và board cảm biến mưa qua ADC trên `PA1`,
có bộ lọc trung bình trượt. Không còn gán số cứng nữa.

---

## 7. Đừng bật hai bộ não tự động cùng lúc

Hệ thống có **hai** engine tự động, chỉ được dùng một:

- **ESP32** (`handleAutoIrrigationLogic` + `handleAutoMixingLogic`) — chạy tại chỗ,
  mất mạng vẫn tưới. **Đây là cái đang dùng.**
- **Backend** (Cài đặt → *Luật tự động*) — mặc định **tắt hết**, **để nguyên như vậy**.

Bật cả hai thì hai bên giành nhau cùng một relay.

---

## 8. Bảng tra lỗi nhanh

| Hiện tượng | Nguyên nhân |
|---|---|
| VSCode gạch đỏ `HardwareSerial.h` | Không phải lỗi — xem mục 1 |
| `[vite] ws proxy error: ECONNREFUSED ::1:4000` | Quên chạy backend ở terminal thứ hai — xem mục 4 |
| `npm install` lỗi giữa chừng | Project nằm trong OneDrive — xem mục 3 |
| Dashboard trắng trơn, Master OFFLINE | ESP32 chưa vào được WiFi — xem mục 5 |
| Dashboard lên nhưng không có số cảm biến | Bình thường, chờ 2 phút hoặc bấm PB7 trên STM32 |
| Bấm nút trên web không có gì xảy ra | Hệ thống đang ở **TỰ ĐỘNG** — chuyển sang **THỦ CÔNG** |
| Web hiện bơm ON nhưng bơm không chạy | Vào trang **Cảnh báo**; nếu báo "lệnh không được xác nhận" thì LoRa tới Nano đang đứt |
| Đăng nhập không được | Backend chưa chạy, hoặc chạy nhầm cổng — mở `http://localhost:4000/api/health` xem có trả `ok` không |

---

## 9. Trước khi mở ra Internet

Repo đang để **công khai** ba thứ, chấp nhận được với mạng LAN phòng lab, nhưng
**bắt buộc đổi** nếu đưa ra ngoài:

| Cần đổi | Ở đâu |
|---|---|
| `DEVICE_API_KEY` | `backend/.env` **và** `esp32_master.ino` — phải đổi **cả hai phía** |
| `JWT_SECRET` | `backend/.env` |
| Mật khẩu `admin` | Đăng nhập rồi đổi trong dashboard |

---

## Tài liệu khác

| File | Nội dung |
|---|---|
| [HUONG-DAN-CHAY-THAT.md](HUONG-DAN-CHAY-THAT.md) | 8 bước từ code tới đo thật ngoài đồng, kèm sơ đồ chân từng board |
| [HUONG-DAN-TRIEN-KHAI.docx](HUONG-DAN-TRIEN-KHAI.docx) | Bản Word — mục 3 là bảng tra biến config theo từng máy |
| [firmware/README.md](firmware/README.md) | Chi tiết 3 board và cầu nối web |
| [README.md](README.md) | Tổng quan kiến trúc hệ thống |
