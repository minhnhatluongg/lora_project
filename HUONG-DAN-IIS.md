# 🖥️ Đưa backend lên Windows Server + IIS

Hướng dẫn này đưa **backend Node.js** lên Windows Server, cho IIS đứng trước làm
cầu. Frontend tạm thời vẫn chạy ở máy bạn.

```
Internet ──► IIS :80 ──► 127.0.0.1:4000 (Node, dịch vụ Windows)
                │
ESP32 ──────────┘  gọi http://tenmien/api/...
```

---

## 0. Ba điều biết trước cho đỡ mất công

**Backend KHÔNG có bước build.** `npm start` chỉ là `node src/index.js`. Không
Webpack, không TypeScript, không `dist/`. Chỉ frontend mới cần `npm run build`.

**Đừng dùng iisnode.** Nó gần như ngừng phát triển từ 2019 và **không chạy được
ESM** — mà `backend/package.json` khai `"type": "module"`. Cách đúng là Node chạy
riêng như dịch vụ Windows, IIS chỉ chuyển tiếp.

**Node trên server phải cùng dòng phiên bản với máy bạn.** `better-sqlite3` là
module biên dịch sẵn theo từng phiên bản Node; lệch quá xa là `npm install` phải
biên dịch tay và cần Visual Studio Build Tools. Máy bạn đang dùng **Node 22**, cứ
cài Node 22 LTS lên server là khớp.

---

## 1. Cài sẵn trên server

| Cần | Lấy ở đâu |
|---|---|
| **Node.js 22 LTS** | nodejs.org — bản `.msi` cho Windows x64 |
| **NSSM** | nssm.cc/download — giải nén, lấy `win64\nssm.exe` |
| **URL Rewrite 2.1** | Web Platform Installer hoặc tải trực tiếp từ Microsoft |
| **ARR 3.0** | Application Request Routing — tải từ Microsoft |

Bật thêm tính năng Windows (PowerShell **quyền Administrator**):

```powershell
Install-WindowsFeature Web-Server, Web-WebSockets, Web-Mgmt-Console
```

> `Web-WebSockets` là bắt buộc. Thiếu nó thì dashboard mở được nhưng **số liệu
> đứng im**, phải F5 mới thấy — vì Socket.IO không bắt tay được.

Kiểm tra:

```powershell
node -v          # phải ra v22.x
```

---

## 2. Đưa code lên server

Chọn một trong hai:

```powershell
# Cách A — có git trên server
cd C:\inetpub
git clone https://github.com/minhnhatluongg/lora_project.git lora

# Cách B — chép tay
# Chép thư mục backend\ sang C:\inetpub\lora\backend
# KHÔNG chép node_modules — cài lại ở bước sau
```

---

## 3. Cài thư viện và cấu hình

```powershell
cd C:\inetpub\lora\backend
npm install --omit=dev
copy .env.example .env
notepad .env
```

Sửa **bốn dòng** trong `.env`:

```ini
PORT=4000

# Tên miền thật, nơi trình duyệt mở dashboard.
# Nhiều nguồn thì ngăn nhau bằng dấu phẩy.
CORS_ORIGIN=http://iot.tenmiencuaban.com,http://localhost:5173

# ĐỔI — khóa cũ nằm công khai trên GitHub
DEVICE_API_KEY=<chuỗi ngẫu nhiên dài>
JWT_SECRET=<chuỗi ngẫu nhiên khác>
```

> `CORS_ORIGIN` phải có `http://localhost:5173` **trong lúc bạn còn chạy frontend
> ở máy nhà**. Xong việc thì bỏ ra.

Sinh khóa ngẫu nhiên:

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

### Chạy thử bằng tay trước

Đừng vội dựng dịch vụ. Chạy tay để thấy lỗi ngay nếu có:

```powershell
npm start
```

Phải in ra:

```
[db] Seeded default admin: admin / admin123
🌱 LoRa farm backend running on http://localhost:4000
   Socket.IO + REST API ready
```

Mở trình duyệt **ngay trên server**: `http://localhost:4000/api/health` → thấy
`{"ok":true,...}`. Xong thì `Ctrl+C` tắt đi.

> Lỗi hay gặp ở bước này là `better-sqlite3`. Nếu báo lỗi module, xóa
> `node_modules` rồi `npm install` lại — thường do phiên bản Node lệch.

---

## 4. Dựng Node thành dịch vụ Windows (NSSM)

Chạy tay thì đóng cửa sổ là chết, khởi động lại máy là mất. Dịch vụ thì tự bật.

Chép `nssm.exe` vào `C:\nssm\nssm.exe`, rồi PowerShell **quyền Administrator**:

```powershell
$nssm = "C:\nssm\nssm.exe"
$svc  = "LoraFarmBackend"
$app  = "C:\inetpub\lora\backend"

New-Item -ItemType Directory -Force "$app\logs" | Out-Null

& $nssm install $svc "C:\Program Files\nodejs\node.exe" "src\index.js"
& $nssm set $svc AppDirectory      $app
& $nssm set $svc AppStdout         "$app\logs\out.log"
& $nssm set $svc AppStderr         "$app\logs\err.log"
& $nssm set $svc AppRotateFiles    1
& $nssm set $svc AppRotateBytes    10485760
& $nssm set $svc Start             SERVICE_AUTO_START
& $nssm set $svc AppExit Default   Restart
& $nssm set $svc Description       "LoRa farm backend (Node + SQLite)"

& $nssm start $svc
& $nssm status $svc      # phải ra SERVICE_RUNNING
```

Kiểm tra lại: `http://localhost:4000/api/health` vẫn trả `ok`.

### Quyền ghi cho SQLite

Dịch vụ chạy bằng tài khoản `LocalSystem`, cần ghi được vào `backend\data`:

```powershell
icacls "C:\inetpub\lora\backend\data" /grant "SYSTEM:(OI)(CI)F" /T
```

Thiếu quyền này thì dịch vụ khởi động rồi chết ngay — xem `logs\err.log`.

### Lệnh dùng về sau

```powershell
& $nssm restart LoraFarmBackend    # sau khi sửa .env hoặc git pull
& $nssm stop    LoraFarmBackend
& $nssm remove  LoraFarmBackend confirm
Get-Content "$app\logs\err.log" -Tail 30    # xem lỗi
```

---

## 5. Bật chế độ proxy cho ARR

**Bước này hay bị quên nhất, và quên là mọi thứ trả về 404.**

Mở **IIS Manager**, bấm vào **tên server** (nút gốc trên cùng bên trái, không
phải site) → **Application Request Routing Cache** → cột phải chọn **Server
Proxy Settings…** → tick **Enable proxy** → **Apply**.

Làm bằng lệnh cũng được:

```powershell
Import-Module WebAdministration
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' `
  -Filter 'system.webServer/proxy' -Name 'enabled' -Value 'True'
```

---

## 6. Tạo site và web.config

Tạo site trong IIS Manager: **Sites → Add Website**

| Ô | Điền |
|---|---|
| Site name | `lora` |
| Physical path | `C:\inetpub\lora\site` |
| Binding | http, port **80**, Host name `iot.tenmiencuaban.com` |

Tạo thư mục đó rồi đặt `web.config` vào:

```powershell
New-Item -ItemType Directory -Force "C:\inetpub\lora\site" | Out-Null
notepad "C:\inetpub\lora\site\web.config"
```

Nội dung:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>

    <!-- BẮT BUỘC phải là false.
         Nghe ngược đời nhưng đúng: tính năng WebSocket của Windows vẫn phải
         được CÀI (bước 1), còn ở đây phải TẮT để IIS không tự xử lý WebSocket
         mà nhường cho ARR chuyển tiếp nguyên vẹn xuống Node.
         Để true thì Socket.IO bắt tay hỏng, dashboard không tự cập nhật. -->
    <webSocket enabled="false" />

    <rewrite>
      <rules>

        <!-- Luật proxy phải đứng TRƯỚC luật SPA bên dưới -->
        <rule name="Proxy API va Socket.IO" stopProcessing="true">
          <match url="^(api|socket\.io)(/.*)?$" />
          <action type="Rewrite" url="http://127.0.0.1:4000/{R:1}{R:2}" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="http" />
          </serverVariables>
        </rule>

        <!-- Chỉ cần khi nào bạn đưa luôn frontend lên đây.
             Router của React chạy phía trình duyệt, nên mọi đường chưa khớp
             file thật đều phải trả về index.html. -->
        <rule name="SPA fallback">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile"      negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>

      </rules>
    </rewrite>

    <!-- Node tự đặt header CORS rồi; để IIS thêm lần nữa là trình duyệt báo
         "multiple values" và chặn hết. -->
    <httpProtocol>
      <customHeaders>
        <remove name="X-Powered-By" />
      </customHeaders>
    </httpProtocol>

  </system.webServer>
</configuration>
```

`serverVariables` cần được cho phép ở cấp server, nếu không IIS báo lỗi 500.19:

```powershell
Add-WebConfiguration -Filter "/system.webServer/rewrite/allowedServerVariables" `
  -PSPath "MACHINE/WEBROOT/APPHOST" -Value @{name='HTTP_X_FORWARDED_PROTO'}
```

---

## 7. Mở tường lửa

```powershell
New-NetFirewallRule -DisplayName "HTTP 80" -Direction Inbound `
  -Protocol TCP -LocalPort 80 -Action Allow
```

**Không mở cổng 4000 ra ngoài.** Node chỉ cần nghe ở `127.0.0.1`; ai cũng vào
được 4000 nghĩa là họ đi vòng qua IIS.

---

## 8. Nghiệm thu

Chạy **từ máy khác**, không phải trên server:

| Bước | Lệnh / thao tác | Kết quả đúng |
|---|---|---|
| 1 | `curl http://iot.tenmiencuaban.com/api/health` | `{"ok":true,...}` |
| 2 | `curl -X POST http://iot.tenmiencuaban.com/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"admin123\"}"` | trả về `token` |
| 3 | `curl "http://iot.tenmiencuaban.com/socket.io/?EIO=4&transport=polling"` | `200`, nội dung bắt đầu bằng `0{"sid"...` |
| 4 | Khởi động lại server | dịch vụ tự bật, bước 1 vẫn chạy |

**Bước 3 là bước quan trọng nhất.** Nó chứng minh WebSocket đi qua được. Nếu ra
404 hoặc 400 thì xem lại `<webSocket enabled="false" />` và **Enable proxy**.

---

## 9. Nối phần còn lại

### Frontend ở máy bạn

Tạo `frontend\.env.local`:

```
VITE_PROXY_TARGET=http://iot.tenmiencuaban.com
```

Rồi `npm run dev`. Trình duyệt vẫn mở `localhost:5173`, Vite chuyển tiếp sang
server — **không cần đụng CORS**.

### ESP32

Sửa **một dòng** trong `firmware/esp32_master/esp32_master.ino`:

```cpp
const char* BACKEND_BASE = "http://iot.tenmiencuaban.com";   // bỏ :4000
const char* DEVICE_API_KEY = "<đúng khóa đã đặt trong .env>";
```

ESP32 **không cần cùng WiFi với server nữa**. Nạp xong mở Serial Monitor 115200:

| In ra | Nghĩa |
|---|---|
| `POST /telemetry -> 201` | ✅ Xong |
| `-> -1` | Sai tên miền, DNS chưa trỏ, hoặc tường lửa chặn |
| `-> 401` | Khóa API hai bên lệch |

---

## 10. Bảng tra lỗi

| Hiện tượng | Nguyên nhân |
|---|---|
| `/api/*` trả **404** | Quên **Enable proxy** ở bước 5 |
| `/api/*` trả **502.3** | Dịch vụ Node chưa chạy — `nssm status LoraFarmBackend` |
| **500.19** khi mở trang | Chưa cho phép `serverVariables` (cuối bước 6) |
| Trang mở được, **số liệu đứng im** | `<webSocket enabled="false" />` bị thiếu, hoặc chưa cài `Web-WebSockets` |
| Trình duyệt báo lỗi **CORS** | `CORS_ORIGIN` trong `.env` chưa có tên miền / `localhost:5173` |
| Dịch vụ bật rồi **tắt ngay** | Thiếu quyền ghi `backend\data` — xem `logs\err.log` |
| `Cannot find module` | Quên `npm install`, hoặc chép nhầm cả `node_modules` từ máy khác |

---

## 11. Sau này cập nhật code

```powershell
cd C:\inetpub\lora
git pull
cd backend
npm install --omit=dev          # chỉ khi package.json đổi
& C:\nssm\nssm.exe restart LoraFarmBackend
```

Database `backend\data\farm.db` **không bị đụng** — cấu hình ngưỡng và lịch sử
đo giữ nguyên qua các lần cập nhật.

---

## ⚠️ Trước khi coi là xong

- [ ] Đổi mật khẩu `admin` (đăng nhập rồi đổi trong dashboard)
- [ ] `DEVICE_API_KEY` và `JWT_SECRET` đã đổi khỏi giá trị mặc định
- [ ] Cổng 4000 **không** mở ra Internet
- [ ] Bỏ `localhost:5173` khỏi `CORS_ORIGIN` khi không còn chạy frontend ở nhà

> **ESP32 đang gọi HTTP trần**, nên `x-api-key` đi không mã hóa trên đường
> truyền. Chấp nhận được cho đồ án, nhưng nên chặn IP ở IIS: chỉ cho IP nơi đặt
> ESP32 gọi vào `/api/telemetry`, `/api/commands/*`, `/api/devices/state`.
> Muốn kín hơn thì nâng ESP32 lên HTTPS — thêm khoảng 8 dòng `WiFiClientSecure`.
