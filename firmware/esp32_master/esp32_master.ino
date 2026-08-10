#include <HardwareSerial.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "time.h"
#include <Preferences.h>

Preferences preferences;

// #####################################################################
// #  CHỈ CẦN SỬA 2 DÒNG WIFI VÀ 1 DÒNG IP LÀ CHẠY ĐƯỢC NGAY           #
// #####################################################################

// --- 1. WiFi mà CẢ ESP32 và MÁY CHẠY BACKEND cùng nối vào ---
const char* ssid     = "DESKTOP-2GO7JB8 5238";
const char* password = "78U5%g77kkkkk";

// --- 2. Địa chỉ máy chạy backend (KHÔNG dùng "localhost") ---
// Lấy bằng lệnh ipconfig trên máy đó, dòng "IPv4 Address".
const char* BACKEND_BASE = "http://192.168.1.50:4000";

// --- 3. Khóa API — ĐÃ KHỚP SẴN với backend/.env, không cần sửa ---
const char* DEVICE_API_KEY = "changeme-esp32-secret";

// Đặt 0 nếu muốn chạy hoàn toàn offline (chỉ Nextion + LoRa, không cần mạng).
#define ENABLE_WEB_BRIDGE 1

// #####################################################################

// Nhịp làm việc của cầu nối web
const unsigned long CMD_POLL_INTERVAL   = 3000;   // hỏi lệnh mới mỗi 3 giây
const unsigned long STATE_PUSH_INTERVAL = 20000;  // báo lại trạng thái relay mỗi 20 giây
const uint16_t HTTP_CONNECT_TIMEOUT_MS  = 1500;
const uint16_t HTTP_TIMEOUT_MS          = 2500;

unsigned long lastCmdPoll   = 0;
unsigned long lastStatePush = 0;
bool webEStopEngaged = false;   // trạng thái DỪNG KHẨN CẤP mà web đang yêu cầu

// Trạng thái thật của 5 bơm + 4 van, để đẩy ngược lên web.
// Relay 1..5 = Bơm 1..5 | Relay 6..9 = Van 1..4 (khớp nano_relay.ino).
bool pumpState[5]  = { false, false, false, false, false };
bool valveState[4] = { false, false, false, false };

// ===================== CẤU HÌNH OLED =====================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C
#define I2C_SDA 9
#define I2C_SCL 10
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ===================== CẤU HÌNH LORA (UART 1) =====================
HardwareSerial loraSerial(1);
#define LORA_M0 5
#define LORA_M1 6
#define LORA_AUX 8
#define LORA_RX_PIN 18
#define LORA_TX_PIN 17

// ===================== CẤU HÌNH NEXTION (UART 2) =====================
HardwareSerial nextion(2);
#define NEXTION_RX 12
#define NEXTION_TX 11

// ===================== CẤU HÌNH NTP =====================
// (ssid / password khai báo ở khối cấu hình đầu file)
const char* ntpServer = "time.google.com";
const long gmtOffset_sec = 7 * 3600;
const int daylightOffset_sec = 0;

// ===================== BIẾN HỆ THỐNG & MẬT KHẨU =====================
String systemPassword;
unsigned long lastUpdate = 0;
int systemMode = -1;  // -1: Chưa chọn | 0: Manual | 1: Auto

// ---> BIẾN LƯU TRẠNG THÁI BƠM 1, VAN 1 VÀ LORA <---
bool bom1State = false;
bool van1State = false;
unsigned long lastLoraRxTime = 0;
const unsigned long LORA_ONLINE_TIMEOUT = 180000UL;  // 3 phút không sóng -> Offline

// --- BIẾN DỮ LIỆU CẢM BIẾN ---
float Temperature = 0.0;  // Nhiệt độ đất
float Humidity = 0.0;     // Độ ẩm đất
uint16_t EC_Value = 0;
float pH_Value = 0.0;
uint16_t Nitrogen = 0;
uint16_t Phosphorus = 0;
uint16_t Potassium = 0;

float Dist1 = 0.0;
float Dist2 = 0.0;
float Dist3 = 0.0;
float Dist4 = 0.0;  // Khoảng cách bồn nước (Dist4 > 80cm là CẠN)

// ---> BỔ SUNG BIẾN CẢM BIẾN MƯA & KHÔNG KHÍ <---
int RainPercent = 0;  // % Mưa (0% = Khô, 100% = Mưa to)
float AirTemp = 0.0;  // Nhiệt độ không khí (°C)
float AirHum = 0.0;   // Độ ẩm không khí (%)

// --- NGƯỠNG CÀI ĐẶT ---
float phMin, phMax, ecMin, ecMax, tempMin, tempMax, humMin, humMax;
int timeBom, timeNghi;                // Đơn vị: Phút
const float WATER_EMPTY_DIST = 80.0;  // Ngưỡng cạn bồn nước (cm)
const int RAIN_MAX_PERCENT = 50;      // Ngưỡng mưa to dừng tưới (%)

// --- BIẾN QUẢN LÝ LORA RETRY & ACK ---
unsigned long lastSendTime = 0;
const int TIMEOUT_MS = 2000;
const int MAX_RETRIES = 3;
int retryCount = 0;
String currentCommand = "";
bool isWaitingAck = false;

// =======================================================
// STATE MACHINE CHO CHẾ ĐỘ AUTO (CHUẨN CÔNG NGHIỆP)
// =======================================================
enum AutoState {
  AUTO_IDLE,           // Đang chờ đất khô
  AUTO_OPEN_VALVE,     // Bước 1: Gửi lệnh mở Van
  AUTO_WAIT_VALVE,     // Đợi Van mở hoàn toàn (2 giây)
  AUTO_START_PUMP,     // Bước 2: Gửi lệnh bật Bơm
  AUTO_IRRIGATING,     // Đang tưới (Đếm thời gian timeBom)
  AUTO_STOP_PUMP,      // Bước 3: Gửi lệnh tắt Bơm trước
  AUTO_WAIT_PUMP_OFF,  // Đợi Bơm tắt hoàn toàn (2 giây)
  AUTO_CLOSE_VALVE,    // Bước 4: Gửi lệnh đóng Van sau
  AUTO_RESTING         // Nghỉ thấm nước (Đếm thời gian timeNghi)
};

AutoState autoState = AUTO_IDLE;
// =======================================================
// STATE MACHINE CHO CHẾ ĐỘ PHA PHÂN (MIXING)
// =======================================================
enum MixState {
  MIX_IDLE,             // Chờ lệnh pha
  MIX_ADD_WATER,        // Bơm nước vào bồn Trộn
  MIX_DOSING_NUTRIENT,  // Nhỏ giọt Đạm, Kali (Nhịp ngắn)
  MIX_STIRRING,         // Khuấy trộn dung dịch
  MIX_WAIT_STABLE       // Chờ cảm biến ổn định để đọc lại
};

MixState mixState = MIX_IDLE;
unsigned long mixStateTimer = 0;
bool isMixingReady = false;  // Cờ báo hiệu: Bồn trộn đã đạt chuẩn EC/pH, sẵn sàng tưới
unsigned long autoStateTimer = 0;

// =======================================================
// HÀM HỖ TRỢ CHUỖI & NEXTION
// =======================================================
String getValue(String data, char separator, int index) {
  int found = 0;
  int strIndex[] = { 0, -1 };
  int maxIndex = data.length() - 1;
  for (int i = 0; i <= maxIndex && found <= index; i++) {
    if (data.charAt(i) == separator || i == maxIndex) {
      found++;
      strIndex[0] = strIndex[1] + 1;
      strIndex[1] = (i == maxIndex) ? i + 1 : i;
    }
  }
  return found > index ? data.substring(strIndex[0], strIndex[1]) : "";
}

void sendNextionCmd(String cmd) {
  nextion.print(cmd);
  nextion.write(0xFF);
  nextion.write(0xFF);
  nextion.write(0xFF);
}

void sendText(String obj, String txt) {
  sendNextionCmd(obj + "=\"" + txt + "\"");
}

void sendValue(String obj, int val) {
  sendNextionCmd(obj + "=" + String(val));
}

// =======================================================
// HÀM CẬP NHẬT OLED & LORA
// =======================================================
void updateOLED(String line1, String line2) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(line1);
  display.setCursor(0, 16);
  display.println(line2);
  display.display();
}

void sendLoRaCommand(String cmd) {
  while (loraSerial.available()) { loraSerial.read(); }
  currentCommand = cmd;
  isWaitingAck = true;
  retryCount = 0;

  // Ghi nhận trạng thái relay ngay tại đây, một chỗ duy nhất, nên logic AUTO và
  // logic pha phân cũng được đồng bộ lên web mà không phải sửa từng lời gọi.
  if (cmd.startsWith("<ON") && cmd.endsWith(">")) {
    noteRelayState(cmd.substring(3, cmd.length() - 1).toInt(), true);
  } else if (cmd.startsWith("<OFF") && cmd.endsWith(">")) {
    noteRelayState(cmd.substring(4, cmd.length() - 1).toInt(), false);
  }

  while (digitalRead(LORA_AUX) == LOW) { delay(5); }

  loraSerial.println(cmd);
  lastSendTime = millis();

  Serial.print("  [LORA TX -> NANO] Gửi lệnh: ");
  Serial.println(cmd);
  updateOLED("GUI LENH LORA:", cmd);
}

// #####################################################################
// #  CẦU NỐI VỚI DASHBOARD WEB (backend Node.js)                      #
// #####################################################################
// ESP32 vừa là Master của mạng LoRa, vừa là cầu nối lên web:
//   * mỗi gói <DATA:...> từ STM32  ->  POST /api/telemetry
//   * mỗi vài giây hỏi /api/commands/pending  ->  dịch thành <ONn>/<OFFn>
//   * báo lại trạng thái 9 relay   ->  POST /api/devices/state
//   * web bấm DỪNG KHẨN CẤP        ->  phát <ESTOP> xuống Nano
// Nextion và toàn bộ logic AUTO cũ giữ nguyên; mất mạng thì hệ thống vẫn
// chạy bình thường, chỉ là web không cập nhật.

// Khi backend không với tới được, nghỉ một lúc rồi thử lại. Không có cái này
// thì mỗi vòng loop sẽ đứng ~4 giây vì chờ timeout, làm HMI giật.
unsigned long bridgeBackoffUntil = 0;
const unsigned long BRIDGE_BACKOFF_MS = 15000;

bool bridgeReady() {
#if !ENABLE_WEB_BRIDGE
  return false;
#else
  if (WiFi.status() != WL_CONNECTED) return false;
  if (millis() < bridgeBackoffUntil) return false;
  return true;
#endif
}

void bridgeBegin(HTTPClient& http, const String& path) {
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);
  http.begin(String(BACKEND_BASE) + path);
  http.addHeader("x-api-key", DEVICE_API_KEY);
}

// Trích một trường chuỗi / số từ JSON. Backend do chính dự án này viết nên
// định dạng cố định — làm thủ công để khỏi phải cài thêm thư viện ArduinoJson.
String jsonStr(const String& src, const char* key) {
  String pat = String("\"") + key + "\":\"";
  int i = src.indexOf(pat);
  if (i < 0) return "";
  i += pat.length();
  int j = src.indexOf('"', i);
  return (j < 0) ? "" : src.substring(i, j);
}

long jsonNum(const String& src, const char* key, long fallback) {
  String pat = String("\"") + key + "\":";
  int i = src.indexOf(pat);
  if (i < 0) return fallback;
  i += pat.length();
  int j = i;
  while (j < (int)src.length() && (isDigit(src[j]) || src[j] == '-')) j++;
  return (j == i) ? fallback : src.substring(i, j).toInt();
}

// device_id của backend -> số relay của Nano.
// pump1..pump5 = relay 1..5 | van1..van4 = relay 6..9 | 0 = không phải relay.
int relayForDeviceId(const String& id) {
  if (id.startsWith("pump")) {
    int n = id.substring(4).toInt();
    return (n >= 1 && n <= 5) ? n : 0;
  }
  if (id.startsWith("van")) {
    int n = id.substring(3).toInt();
    return (n >= 1 && n <= 4) ? n + 5 : 0;
  }
  return 0;
}

// Ghi nhớ trạng thái relay ở phía ESP32 để còn báo ngược lên web.
void noteRelayState(int relayNum, bool isOn) {
  if (relayNum >= 1 && relayNum <= 5) {
    pumpState[relayNum - 1] = isOn;
    if (relayNum == 1) bom1State = isOn;
  } else if (relayNum >= 6 && relayNum <= 9) {
    valveState[relayNum - 6] = isOn;
    if (relayNum == 6) van1State = isOn;
  }
}

// --- Đẩy một lượt đo lên web -----------------------------------------
// Gọi ngay sau khi phân tích xong gói <DATA:...> của STM32.
void postTelemetryToBackend() {
  if (!bridgeReady()) return;

  // STM32 không gửi kèm trạng thái đường Modbus. Khi đầu dò RS485 mất kết nối,
  // cả 4 chỉ số đầu đều đứng ở 0 — dùng dấu hiệu đó để báo TIMEOUT cho web,
  // thay vì im lặng để dashboard tưởng số 0 là số đo thật.
  bool soilDead = (Temperature == 0.0 && Humidity == 0.0 && EC_Value == 0 && pH_Value == 0.0);

  String body = "{";
  if (!soilDead) {
    body += "\"temperature\":" + String(Temperature, 1);
    body += ",\"humidity\":"   + String(Humidity, 1);
    body += ",\"ec\":"         + String(EC_Value);      // µS/cm, đúng như đầu dò
    body += ",\"ph\":"         + String(pH_Value, 1);
    body += ",\"n\":"          + String(Nitrogen);
    body += ",\"p\":"          + String(Phosphorus);
    body += ",\"k\":"          + String(Potassium);
    body += ",";
  }
  body += "\"dist1\":"        + String(Dist1, 1);
  body += ",\"dist2\":"       + String(Dist2, 1);
  body += ",\"dist3\":"       + String(Dist3, 1);
  body += ",\"dist4\":"       + String(Dist4, 1);       // -1 = không có tiếng vọng
  body += ",\"rain\":"        + String(RainPercent);
  body += ",\"air_temp\":"    + String(AirTemp, 1);
  body += ",\"air_humidity\":" + String(AirHum, 1);
  body += ",\"slave_online\":true";
  body += ",\"sensor_status\":\"" + String(soilDead ? "TIMEOUT" : "OK") + "\"";
  body += "}";

  HTTPClient http;
  bridgeBegin(http, "/api/telemetry");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();

  if (code <= 0) {
    bridgeBackoffUntil = millis() + BRIDGE_BACKOFF_MS;
    Serial.printf("  [WEB] POST /telemetry lỗi %d — tạm nghỉ %lus\r\n", code, BRIDGE_BACKOFF_MS / 1000);
  } else {
    Serial.printf("  [WEB] POST /telemetry -> %d\r\n", code);
  }
}

// --- Báo lại trạng thái thật của 9 relay ------------------------------
void pushDeviceStateToBackend() {
  if (!bridgeReady()) return;

  String body = "{";
  for (int i = 0; i < 5; i++) {
    body += "\"pump" + String(i + 1) + "\":\"" + (pumpState[i] ? "ON" : "OFF") + "\",";
  }
  for (int i = 0; i < 4; i++) {
    body += "\"van" + String(i + 1) + "\":\"" + (valveState[i] ? "ON" : "OFF") + "\"";
    if (i < 3) body += ",";
  }
  body += "}";

  HTTPClient http;
  bridgeBegin(http, "/api/devices/state");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();
  if (code <= 0) bridgeBackoffUntil = millis() + BRIDGE_BACKOFF_MS;
}

// --- Xác nhận đã thực thi (hoặc từ chối) một lệnh của web --------------
void ackBackendCommand(long id, bool ok) {
  if (!bridgeReady() || id < 0) return;
  HTTPClient http;
  bridgeBegin(http, "/api/commands/" + String(id) + "/ack");
  http.addHeader("Content-Type", "application/json");
  http.POST(ok ? "{\"success\":true}" : "{\"success\":false}");
  http.end();
}

// --- Web bấm DỪNG KHẨN CẤP -------------------------------------------
void syncEStopFromBackend() {
  if (!bridgeReady()) return;

  HTTPClient http;
  bridgeBegin(http, "/api/status");
  int code = http.GET();
  String payload = (code == 200) ? http.getString() : "";
  http.end();
  if (code != 200) { bridgeBackoffUntil = millis() + BRIDGE_BACKOFF_MS; return; }

  bool engaged = payload.indexOf("\"eStop\":true") >= 0;

  if (engaged && !webEStopEngaged) {
    // Một lệnh <ESTOP> cắt sạch 10 relay ngay, nhanh hơn nhiều so với chờ
    // 9 lệnh OFF lần lượt đi qua hàng đợi.
    Serial.println(">> [WEB] Nhận lệnh DỪNG KHẨN CẤP từ dashboard!");
    sendLoRaCommand("<ESTOP>");
    for (int i = 0; i < 5; i++) pumpState[i] = false;
    for (int i = 0; i < 4; i++) valveState[i] = false;
    bom1State = false;
    van1State = false;
    autoState = AUTO_IDLE;
    mixState = MIX_IDLE;
    systemMode = 0;
    updateOLED("DUNG KHAN CAP", "Lenh tu Dashboard");
    updateDashboard();
  }
  webEStopEngaged = engaged;
}

// --- Lấy và thực thi một lệnh đang chờ từ web -------------------------
// Mỗi lượt chỉ xử lý MỘT lệnh, vì sendLoRaCommand() còn phải chờ ACK của Nano.
void pollBackendCommands() {
  if (!bridgeReady() || isWaitingAck) return;

  // limit=1: chỉ nhận đúng một lệnh, vì còn phải chờ Nano báo ACK qua LoRa mới
  // gửi được lệnh kế. Lấy cả chùm sẽ khiến những lệnh chưa kịp làm bị đánh dấu
  // 'sent' rồi phải chờ hết thời gian thử lại mới quay về hàng đợi.
  HTTPClient http;
  bridgeBegin(http, "/api/commands/pending?limit=1");
  int code = http.GET();
  String payload = (code == 200) ? http.getString() : "";
  http.end();

  if (code != 200) { bridgeBackoffUntil = millis() + BRIDGE_BACKOFF_MS; return; }
  int open = payload.indexOf('{');
  if (open < 0) return;                       // "[]" — không có lệnh nào

  int close = payload.indexOf('}', open);
  String first = payload.substring(open, close < 0 ? payload.length() : close + 1);

  long id       = jsonNum(first, "id", -1);
  String devId  = jsonStr(first, "device_id");
  String action = jsonStr(first, "action");
  if (id < 0 || devId.length() == 0) return;

  Serial.println("  [WEB] Lệnh #" + String(id) + ": " + devId + " -> " + action);

  // a) Đổi chế độ AUTO / MANUAL
  if (devId == "mode") {
    systemMode = (action == "AUTO") ? 1 : 0;
    if (systemMode == 0) { bom1State = false; van1State = false; }
    sendLoRaCommand("<SET_MODE=" + action + ">");
    sendValue("page3.bt10.val", systemMode == 1 ? 1 : 0);
    sendValue("page3.bt9.val",  systemMode == 1 ? 0 : 1);
    updateDashboard();
    ackBackendCommand(id, true);
    return;
  }

  // b) Khởi động lại — xác nhận TRƯỚC khi reboot, nếu không lệnh sẽ treo lại
  //    ở hàng đợi và chạy lần nữa ngay sau khi ESP32 vừa bật lên.
  if (devId == "system" && action == "RESTART") {
    ackBackendCommand(id, true);
    updateOLED("SYSTEM", "Rebooting...");
    delay(300);
    ESP.restart();
    return;
  }

  // c) Bật/tắt bơm hoặc van
  int relay = relayForDeviceId(devId);
  if (relay == 0) { ackBackendCommand(id, false); return; }

  // Ở chế độ TỰ ĐỘNG, Nano từ chối mọi lệnh tay (nano_relay.ino: "KHÓA AN TOÀN").
  // Nếu cứ xác nhận thành công thì web sẽ hiển thị một trạng thái không có thật,
  // nên phải báo hỏng để backend đánh dấu 'failed' và giữ nguyên trạng thái cũ.
  if (systemMode == 1) {
    Serial.println("     -> đang ở TỰ ĐỘNG, từ chối lệnh tay từ web");
    ackBackendCommand(id, false);
    return;
  }

  bool wantOn = (action == "ON");
  sendLoRaCommand(wantOn ? ("<ON" + String(relay) + ">") : ("<OFF" + String(relay) + ">"));
  noteRelayState(relay, wantOn);
  updateDashboard();
  ackBackendCommand(id, true);
  pushDeviceStateToBackend();
}

// =======================================================
// HÀM QUẢN LÝ DASHBOARD & WIFI (3 ICON + CẢM BIẾN MỚI)
// =======================================================
void updateWiFiIcon() {
  int currentState = (WiFi.status() == WL_CONNECTED) ? 1 : 0;
  int isVisible = (currentState == 1) ? 0 : 1;
  sendNextionCmd("vis pwifi," + String(isVisible));
}

void updateDashboard() {
  // 1. Gửi các thông số cảm biến đất & bồn nước (t0 -> t9)
  sendText("t0.txt", String(Temperature, 1));
  sendText("t1.txt", String(Humidity, 1));
  sendText("t2.txt", String(pH_Value, 1));
  sendText("t3.txt", String(EC_Value));
  sendText("t4.txt", String(Potassium));
  sendText("t5.txt", String(Nitrogen));
  sendText("t6.txt", String(Dist1, 1));
  sendText("t7.txt", String(Dist2, 1));
  sendText("t8.txt", String(Dist3, 1));
  sendText("t9.txt", String(Dist4, 1));

  // ---> 2. GỬI 3 THÔNG SỐ CẢM BIẾN MỚI LÊN DASHBOARD (t10, t11, t12) <---
  sendText("t10.txt", String(RainPercent));  // t10: % Mưa
  sendText("t11.txt", String(AirTemp, 1));   // t11: Nhiệt độ không khí
  sendText("t12.txt", String(AirHum, 1));    // t12: Độ ẩm không khí

  // 3. Tính trạng thái LoRa Online (Nhận gói tin trong vòng 3 phút qua)
  bool isLoraOnline = (lastLoraRxTime > 0) && (millis() - lastLoraRxTime < LORA_ONLINE_TIMEOUT);

  // // 4. GỬI LỆNH ĐỔI ICON TRẠNG THÁI LÊN NEXTION (ID 37 = Xanh ON, 36 = Xám OFF)
  // int idBom1  = bom1State    ? 37 : 36;
  // int idVan1  = van1State    ? 37 : 36;
  // int idLoRa  = isLoraOnline ? 37 : 36;

  // sendValue("q0.picc", idBom1);
  // sendValue("q1.picc", idVan1);
  // sendValue("q2.picc", idLoRa);
}

void updateClock() {
  struct tm t;
  if (!getLocalTime(&t)) return;
  char str[20];
  sprintf(str, "%02d:%02d:%02d", t.tm_hour, t.tm_min, t.tm_sec);
  sendText("time.txt", str);
  sprintf(str, "%02d/%02d/%04d", t.tm_mday, t.tm_mon + 1, t.tm_year + 1900);
  sendText("date.txt", str);
}
// =====================================================================
// HÀM XỬ LÝ LOGIC PHA PHÂN BÓN TỰ ĐỘNG (CHUẨN EC/pH)
// =====================================================================
void handleAutoMixingLogic() {
  if (systemMode != 1) {
    mixState = MIX_IDLE;
    return;
  }

  unsigned long currentMillis = millis();

  switch (mixState) {
    case MIX_IDLE:
      // Kích hoạt pha phân nếu dung dịch chưa sẵn sàng và Bồn nước chưa cạn
      if (!isMixingReady && Dist4 < WATER_EMPTY_DIST) {
        Serial.println(">> [MIXER] Bắt đầu quy trình pha phân bón...");
        mixState = MIX_ADD_WATER;
      }
      break;

    case MIX_ADD_WATER:
      // Dist3 là cảm biến siêu âm bồn Trộn (khoảng cách > 50cm là cạn, cần bơm)
      if (Dist3 > 50.0 && Dist3 != -1.0) {
        sendLoRaCommand("<ON3>");  // BẬT BƠM 3 (HÚT NƯỚC)
      } else {
        sendLoRaCommand("<OFF3>");  // TẮT BƠM 3
        mixStateTimer = currentMillis;
        mixState = MIX_WAIT_STABLE;
      }
      break;

    case MIX_WAIT_STABLE:
      // Đợi 5 giây để nước tĩnh lại, đọc cảm biến cho chuẩn
      if (currentMillis - mixStateTimer >= 5000 && !isWaitingAck) {
        if (EC_Value < ecMin) {
          Serial.printf(">> [MIXER] EC = %d < %d. Đang châm thêm Đạm & Kali...\r\n", EC_Value, (int)ecMin);
          mixState = MIX_DOSING_NUTRIENT;
          mixStateTimer = currentMillis;

          sendLoRaCommand("<ON1>");  // BẬT BƠM 1 (HÚT ĐẠM)
          sendLoRaCommand("<ON2>");  // BẬT BƠM 2 (HÚT KALI)
        } else if (EC_Value > ecMax) {
          Serial.println(">> [MIXER] CẢNH BÁO: EC quá cao, cần châm thêm nước để pha loãng!");
          mixState = MIX_ADD_WATER;
        } else {
          Serial.println(">> [MIXER] Dinh dưỡng đạt chuẩn! HỆ THỐNG SẴN SÀNG TƯỚI.");
          isMixingReady = true;
          mixState = MIX_IDLE;
        }
      }
      break;

    case MIX_DOSING_NUTRIENT:
      // Bơm Đạm và Kali chạy một nhịp RẤT NGẮN (ví dụ 3 giây) rồi tắt
      if (currentMillis - mixStateTimer >= 3000 && !isWaitingAck) {
        sendLoRaCommand("<OFF1>");  // TẮT BƠM 1 (ĐẠM)
        sendLoRaCommand("<OFF2>");  // TẮT BƠM 2 (KALI)

        mixState = MIX_STIRRING;
        mixStateTimer = currentMillis;
        sendLoRaCommand("<ON4>");  // BẬT BƠM 4 (MOTOR TRỘN)
      }
      break;

    case MIX_STIRRING:
      // Khuấy trong vòng 10 giây để phân tan đều vào nước
      if (currentMillis - mixStateTimer >= 10000 && !isWaitingAck) {
        sendLoRaCommand("<OFF4>");  // TẮT BƠM 4 (TRỘN)
        mixState = MIX_WAIT_STABLE;
        mixStateTimer = currentMillis;
      }
      break;
  }
}
// =====================================================================
// HÀM XỬ LÝ LOGIC AUTO CHUẨN THỰC TẾ (TUẦN TỰ + KHÓA CHÉO + TỪ TRỄ)
// =====================================================================
void handleAutoIrrigationLogic() {
  if (systemMode != 1) {
    autoState = AUTO_IDLE;
    return;
  }

  // 1. KHÓA CHÉO AN TOÀN KHẨN CẤP
  bool isTankEmpty = (Dist4 > WATER_EMPTY_DIST && Dist4 != -1.0);
  bool isHeavyRain = (RainPercent >= RAIN_MAX_PERCENT);

  if (isTankEmpty || isHeavyRain) {
    // Nếu hệ thống đang chạy thì ép dừng khẩn cấp Bơm Tưới và Van 1
    if (autoState != AUTO_IDLE) {
      String reason = isTankEmpty ? "Bồn cạn nước!" : "Trời đang MƯA TO!";
      Serial.println(">> [KHÓA CHÉO KHẨN CẤP]: " + reason + " Đang tắt Bơm & Van ngay lập tức.");

      sendLoRaCommand("<OFF5>");  // TẮT BƠM 5 (BƠM TƯỚI)
      sendLoRaCommand("<OFF6>");  // TẮT VAN 1
      autoState = AUTO_IDLE;

      updateOLED("CANH BAO AN TOAN", isTankEmpty ? "BON CAN NUOC!" : "TROI MUA TO!");
    }
    return;
  }

  // 2. STATE MACHINE ĐIỀU KHIỂN TƯỚI TỰ ĐỘNG
  unsigned long currentMillis = millis();

  switch (autoState) {
    case AUTO_IDLE:
      // Đợi Đất Khô VÀ Dung dịch trộn đã sẵn sàng
      if (Humidity <= humMin && Humidity > 0.0 && isMixingReady == true && !isWaitingAck) {
        Serial.printf(">> [AUTO]: Đất khô (%.1f%%) VÀ Dung dịch đã pha xong. Bắt đầu tưới.\r\n", Humidity);
        autoState = AUTO_OPEN_VALVE;
      }
      break;

    case AUTO_OPEN_VALVE:
      sendLoRaCommand("<ON6>");  // MỞ VAN 1
      autoStateTimer = currentMillis;
      autoState = AUTO_WAIT_VALVE;
      break;

    case AUTO_WAIT_VALVE:
      if (currentMillis - autoStateTimer >= 2000 && !isWaitingAck) {
        autoState = AUTO_START_PUMP;
      }
      break;

    case AUTO_START_PUMP:
      sendLoRaCommand("<ON5>");  // BẬT BƠM 5 (BƠM TƯỚI)
      autoStateTimer = currentMillis;
      autoState = AUTO_IRRIGATING;
      Serial.println(">> [AUTO]: Bơm Tưới & Van đã mở. Đang trong chu kỳ tưới...");
      break;

    case AUTO_IRRIGATING:
      if (Humidity >= humMax || (currentMillis - autoStateTimer >= (unsigned long)timeBom * 60000UL)) {
        if (Humidity >= humMax) {
          Serial.printf(">> [AUTO]: Đất đã đủ ẩm (%.1f%% >= %.1f%%). Dừng tưới.\r\n", Humidity, humMax);
        } else {
          Serial.printf(">> [AUTO]: Hết thời gian tưới 1 chu kỳ (%d phút). Chuyển sang nghỉ thấm.\r\n", timeBom);
        }
        autoState = AUTO_STOP_PUMP;
      }
      break;

    case AUTO_STOP_PUMP:
      sendLoRaCommand("<OFF5>");  // TẮT BƠM 5 (BƠM TƯỚI)
      autoStateTimer = currentMillis;
      autoState = AUTO_WAIT_PUMP_OFF;
      break;

    case AUTO_WAIT_PUMP_OFF:
      if (currentMillis - autoStateTimer >= 2000 && !isWaitingAck) {
        autoState = AUTO_CLOSE_VALVE;
      }
      break;

    case AUTO_CLOSE_VALVE:
      sendLoRaCommand("<OFF6>");  // ĐÓNG VAN 1
      autoStateTimer = currentMillis;

      if (Humidity < humMax) {
        autoState = AUTO_RESTING;
        Serial.printf(">> [AUTO]: Đang nghỉ %d phút để nước thấm sâu vào đất...\r\n", timeNghi);
      } else {
        autoState = AUTO_IDLE;
        // Đặt lại cờ để pha mẻ phân bón mới
        isMixingReady = false;
        Serial.println(">> [AUTO]: Chu trình tưới hoàn tất. Đã reset bồn Trộn để pha mẻ mới!");
      }
      break;

    case AUTO_RESTING:
      if (currentMillis - autoStateTimer >= (unsigned long)timeNghi * 60000UL) {
        autoState = AUTO_IDLE;
      }
      break;
  }
}
// =======================================================
// SETUP
// =======================================================
void setup() {
  Serial.begin(115200);
  Serial.println("\n===============================================");
  Serial.println("     ESP32-S3 MASTER STATION READY             ");
  Serial.println("===============================================");

  Wire.begin(I2C_SDA, I2C_SCL);
  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println("[Loi] OLED Init Failed");
  } else {
    display.setRotation(2);
    updateOLED("MASTER BOOT", "Khoi tao he thong...");
  }

  pinMode(LORA_M0, OUTPUT);
  digitalWrite(LORA_M0, LOW);
  pinMode(LORA_M1, OUTPUT);
  digitalWrite(LORA_M1, LOW);
  pinMode(LORA_AUX, INPUT);
  while (digitalRead(LORA_AUX) == LOW) { delay(10); }

  loraSerial.setRxBufferSize(256);
  loraSerial.begin(9600, SERIAL_8N1, LORA_RX_PIN, LORA_TX_PIN);
  loraSerial.setTimeout(50);
  while (loraSerial.available()) loraSerial.read();

  nextion.begin(115200, SERIAL_8N1, NEXTION_RX, NEXTION_TX);
  nextion.setTimeout(20);
  delay(500);
  while (nextion.available()) nextion.read();

  // --- ĐỌC MẬT KHẨU TỪ FLASH ---
  // LƯU Ý: mọi lời gọi get*/put* đều phải nằm GIỮA begin() và end().
  // Trước đây end() được gọi ngay sau khi đọc mật khẩu, nên 10 ngưỡng bên dưới
  // đọc trên một handle đã đóng và luôn nhận giá trị mặc định — cài đặt người
  // dùng lưu vào Flash không bao giờ được nạp lại sau khi khởi động lại.
  preferences.begin("system_data", false);
  systemPassword = preferences.getString("password", "123456");
  Serial.println(">> [PREFERENCES] Mật khẩu hệ thống hiện tại: " + systemPassword);

  phMin = preferences.getFloat("phMin", 5.5);
  phMax = preferences.getFloat("phMax", 6.5);
  ecMin = preferences.getFloat("ecMin", 1.0);
  ecMax = preferences.getFloat("ecMax", 2.0);
  tempMin = preferences.getFloat("tempMin", 20.0);
  tempMax = preferences.getFloat("tempMax", 35.0);
  humMin = preferences.getFloat("humMin", 50.0);
  humMax = preferences.getFloat("humMax", 75.0);
  timeBom = preferences.getInt("timeBom", 5);
  timeNghi = preferences.getInt("timeNghi", 10);
  preferences.end();

  WiFi.begin(ssid, password);
  updateOLED("WIFI", "Connecting...");
  int wifiAttempts = 0;
  while (WiFi.status() != WL_CONNECTED && wifiAttempts < 20) {
    delay(500);
    Serial.print(".");
    wifiAttempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    struct tm t;
    while (!getLocalTime(&t)) { delay(500); }
    updateOLED("MASTER READY", "WiFi Connected");
    Serial.println("\n[WIFI] Đã kết nối WiFi thành công!");
  } else {
    updateOLED("MASTER READY", "WiFi Offline");
    Serial.println("\n[WIFI] Ngoại tuyến (Offline)!");
  }
  sendNextionCmd("page page0");
}

// =======================================================
// MAIN LOOP
// =======================================================
void loop() {
  // 0. CHẠY LOGIC PHA PHÂN BÓN TRƯỚC
  handleAutoMixingLogic();
  // 1. CHẠY LOGIC TƯỚI TỰ ĐỘNG CHUẨN CÔNG NGHIỆP
  handleAutoIrrigationLogic();

  // 2. ĐỒNG HỒ & DASHBOARD HOẠT ĐỘNG MỖI GIÂY
  if (millis() - lastUpdate >= 1000) {
    lastUpdate = millis();
    updateClock();
    updateWiFiIcon();
  }

  // 2b. CẦU NỐI WEB: nhận lệnh từ dashboard và báo trạng thái ngược lên.
  //     Nếu không có mạng thì các hàm này tự thoát ngay, hệ thống chạy bình
  //     thường bằng Nextion + nút cơ như trước.
  if (millis() - lastCmdPoll >= CMD_POLL_INTERVAL) {
    lastCmdPoll = millis();
    syncEStopFromBackend();
    pollBackendCommands();
  }
  if (millis() - lastStatePush >= STATE_PUSH_INTERVAL) {
    lastStatePush = millis();
    pushDeviceStateToBackend();
  }

  // ===============================================================
  // --- 3. ĐỌC DỮ LIỆU TỪ LORA (NANO VÀ STM32) ---
  // ===============================================================
  if (loraSerial.available()) {
    String incomingData = loraSerial.readStringUntil('\n');
    incomingData.trim();

    // A. Gói cảm biến từ trạm STM32 (<DATA:...>)
    if (incomingData.startsWith("<DATA:") && incomingData.endsWith(">")) {
      lastLoraRxTime = millis();

      String raw = incomingData.substring(6, incomingData.length() - 1);
      Temperature = getValue(raw, ',', 0).toFloat();
      Humidity = getValue(raw, ',', 1).toFloat();
      EC_Value = getValue(raw, ',', 2).toInt();
      pH_Value = getValue(raw, ',', 3).toFloat();
      Nitrogen = getValue(raw, ',', 4).toInt();
      Phosphorus = getValue(raw, ',', 5).toInt();
      Potassium = getValue(raw, ',', 6).toInt();
      Dist1 = getValue(raw, ',', 7).toFloat();
      Dist2 = getValue(raw, ',', 8).toFloat();
      Dist3 = getValue(raw, ',', 9).toFloat();
      Dist4 = getValue(raw, ',', 10).toFloat();

      // ---> ĐỌC THÊM 3 CẢM BIẾN MỚI TỪ STM32 GỬI VỀ <---
      RainPercent = getValue(raw, ',', 11).toInt();  // Index 11: % Mưa
      AirTemp = getValue(raw, ',', 12).toFloat();    // Index 12: Nhiệt độ không khí
      AirHum = getValue(raw, ',', 13).toFloat();     // Index 13: Độ ẩm không khí

      Serial.printf(">> [LORA RX] Đất: %.1fC-%.1f%% | KK: %.1fC-%.1f%% | Mưa: %d%%\r\n",
                    Temperature, Humidity, AirTemp, AirHum, RainPercent);

      updateDashboard();        // Đẩy toàn bộ số liệu mới lên HMI Nextion
      postTelemetryToBackend(); // ...và lên dashboard web
    }

    // B. Xử lý gói ACK xác nhận lệnh từ Arduino Nano (<ACK_...>)
    if (isWaitingAck) {
      String expectedAck = "<ACK_" + currentCommand.substring(1);
      if (incomingData.indexOf(expectedAck) != -1) {
        Serial.println("  [LORA RX <- NANO] Nhận ACK phản hồi thành công: " + expectedAck);
        updateOLED("TRANG THAI: OK", "Lenh: " + currentCommand);
        isWaitingAck = false;
      }
    }

    // C. Xử lý đồng bộ nút nhấn cơ dưới tủ điện (<SYNC:...>)
    if (incomingData.startsWith("<SYNC:") && incomingData.endsWith(">")) {
      String content = incomingData.substring(6, incomingData.length() - 1);
      int equalIdx = content.indexOf('=');

      if (equalIdx != -1) {
        String devName = content.substring(0, equalIdx);
        int stateVal = content.substring(equalIdx + 1).toInt();

        if (devName == "MODE") {
          systemMode = stateVal;
          if (systemMode == 1) {
            sendValue("page3.bt10.val", 1);
            sendValue("page3.bt9.val", 0);
          } else if (systemMode == 0) {
            sendValue("page3.bt10.val", 0);
            sendValue("page3.bt9.val", 1);
            bom1State = false;
            van1State = false;
          }
          updateDashboard();
        } else {
          bool isOn = (stateVal == 1);
          int nextionVal = isOn ? 1 : 0;

          // Cập nhật lên đúng ID nút trên Nextion (Bơm 1-5 là bt0-bt4, Van 1-4 là bt5-bt8)
          if (devName.startsWith("BOM")) {
            int num = devName.substring(3).toInt();  // Lấy số 1 đến 5
            if (num == 1) bom1State = isOn;
            if (num >= 1 && num <= 5) pumpState[num - 1] = isOn;
            sendValue("page3.bt" + String(num - 1) + ".val", nextionVal);
          } else if (devName.startsWith("VAN")) {
            int num = devName.substring(3).toInt();  // Lấy số 1 đến 4
            if (num == 1) van1State = isOn;
            if (num >= 1 && num <= 4) valveState[num - 1] = isOn;
            sendValue("page3.bt" + String(num + 4) + ".val", nextionVal);
          }
          updateDashboard();
          // Nút cơ dưới tủ điện vừa được bấm — báo ngay lên web để dashboard
          // không hiển thị sai so với thực tế ngoài hiện trường.
          pushDeviceStateToBackend();
        }
      }
    }
  }

    // ===============================================================
    // --- 4. XỬ LÝ LỆNH TỪ MÀN HÌNH HMI NEXTION ---
    // ===============================================================
    // `if` chứ không phải `while`, và KHÔNG dùng `return` khi chuỗi rỗng: trước
    // đây một byte rác từ Nextion sẽ thoát khỏi cả vòng loop, bỏ qua luôn khối
    // gửi lại lệnh LoRa ở mục 5 bên dưới.
    if (nextion.available()) {
      String cmd = nextion.readStringUntil('\n');
      cmd.trim();
      if (cmd.length() > 0) {

      String cmdUpper = cmd;
      cmdUpper.toUpperCase();

      // A. ĐĂNG NHẬP (CHECK_PASS=)
      if (cmdUpper.startsWith("CHECK_PASS=")) {
        String enteredPass = cmd.substring(11);
        enteredPass.trim();
        systemPassword.trim();
        if (enteredPass == systemPassword) {
          sendNextionCmd("page page1");
        } else {
          sendNextionCmd("va0.val=1");
          sendNextionCmd("t0.pw=0");
          sendNextionCmd("t0.pco=63488");
          sendNextionCmd("t0.txt=\"X\"");
        }
      }
      // B. ĐỔI MẬT KHẨU (KHỚP VỚI NEXTION GỬI XUỐNG: CHGPASS=)
      else if (cmdUpper.startsWith("CHGPASS=")) {
        String data = cmd.substring(8);
        int firstComma = data.indexOf(',');
        int secondComma = data.lastIndexOf(',');

        if (firstComma != -1 && secondComma != -1 && firstComma != secondComma) {
          String enteredOldPass = data.substring(0, firstComma);
          String enteredNewPass1 = data.substring(firstComma + 1, secondComma);
          String enteredNewPass2 = data.substring(secondComma + 1);

          // Gọt sạch ký tự rác
          enteredOldPass.trim();
          enteredNewPass1.trim();
          enteredNewPass2.trim();
          systemPassword.trim();

          // 1. Kiểm tra mật khẩu cũ
          if (enteredOldPass != systemPassword) {
            Serial.println("[Lỗi] Sai mật khẩu hiện tại!");
            sendNextionCmd("t0.pw=0");
            sendNextionCmd("t0.pco=63488");
            sendNextionCmd("t0.txt=\"X\"");
          }
          // 2. Kiểm tra 2 ô mật khẩu mới có khớp nhau không
          else if (enteredNewPass1 != enteredNewPass2) {
            Serial.println("[Lỗi] 2 ô mật khẩu mới không khớp!");
            sendNextionCmd("t2.pw=0");
            sendNextionCmd("t2.pco=63488");
            sendNextionCmd("t2.txt=\"X\"");
          }
          // 3. Đúng hết -> Lưu vào Flash và văng về trang Login
          else {
            systemPassword = enteredNewPass1;
            preferences.begin("system_data", false);
            preferences.putString("password", systemPassword);
            preferences.end();

            Serial.println("[Thành công] Đã đổi mật khẩu mới: " + systemPassword);

            // Dọn sạch và reset trạng thái trang 7 trước khi đá về trang 0
            sendNextionCmd("page7.t0.txt=\"\"");
            sendNextionCmd("page7.t1.txt=\"\"");
            sendNextionCmd("page7.t2.txt=\"\"");
            sendNextionCmd("page7.t0.pw=1");
            sendNextionCmd("page7.t1.pw=1");
            sendNextionCmd("page7.t2.pw=1");
            sendNextionCmd("page7.bt0.val=0");
            sendNextionCmd("page7.bt1.val=0");
            sendNextionCmd("page7.bt2.val=0");

            // Văng về màn hình đăng nhập (page0)
            sendNextionCmd("page page0");
          }
        }
      }
      // C. CHỌN CHẾ ĐỘ AUTO / MANUAL
      else if (cmdUpper == "CMD=MODE_AUTO") {
        systemMode = 1;
        sendLoRaCommand("<SET_MODE=AUTO>");
        updateDashboard();
      } else if (cmdUpper == "CMD=MODE_MANUAL") {
        systemMode = 0;
        sendLoRaCommand("<SET_MODE=MANUAL>");
        bom1State = false;
        van1State = false;
        updateDashboard();
      }
      // D. ĐIỀU KHIỂN BƠM (Thủ công)
      else if (cmdUpper.startsWith("BOM")) {
        int bomNum = cmd.substring(3, cmd.indexOf('=')).toInt();  // Trả về 1 -> 5
        int state = cmd.substring(cmd.indexOf('=') + 1).toInt();
        bool isOn = (state == 0);  // Nextion thường gửi 0 khi nút ON (tùy cài đặt)

        if (systemMode == 0 && !isWaitingAck) {
          int relayPin = bomNum;  // Bơm 1->5 tương ứng LoRa <ON1> -> <ON5>
          String loraMsg = isOn ? "<ON" + String(relayPin) + ">" : "<OFF" + String(relayPin) + ">";
          if (bomNum == 1) {
            bom1State = isOn;
            updateDashboard();
          }
          sendLoRaCommand(loraMsg);
        } else if (systemMode == 1) {
          Serial.println(">> [CẢNH BÁO] Đang ở AUTO, từ chối lệnh!");
        }
      }
      // E. ĐIỀU KHIỂN VAN (Thủ công)
      else if (cmdUpper.startsWith("VAN")) {
        int vanNum = cmd.substring(3, cmd.indexOf('=')).toInt();  // Trả về 1 -> 4
        int state = cmd.substring(cmd.indexOf('=') + 1).toInt();
        bool isOn = (state == 0);

        if (systemMode == 0 && !isWaitingAck) {
          int relayPin = vanNum + 5;  // Van 1->4 tương ứng LoRa <ON6> -> <ON9>
          String loraMsg = isOn ? "<ON" + String(relayPin) + ">" : "<OFF" + String(relayPin) + ">";
          if (vanNum == 1) {
            van1State = isOn;
            updateDashboard();
          }
          sendLoRaCommand(loraMsg);
        } else if (systemMode == 1) {
          Serial.println(">> [CẢNH BÁO] Đang ở chế độ AUTO, từ chối lệnh thủ công!");
        }
      }
      // F. ĐIỀU HƯỚNG TRANG & ĐỒNG BỘ DASHBOARD
      else if (cmdUpper == "DASHBOARD_READY=") {
        updateWiFiIcon();
        updateDashboard();
      } else if (cmdUpper == "MENU_READY=") {
        updateWiFiIcon();
      }
      // --- KHI MỞ TRANG SETTINGS, ESP32 SẼ ĐIỀN THÔNG SỐ ĐANG LƯU LÊN MÀN HÌNH ---
      else if (cmdUpper == "SETTINGS_READY=") {
        updateWiFiIcon();

        // Đẩy giá trị từ RAM (đã lấy từ Flash lúc khởi động) lên các ô text của Nextion
        sendText("t0.txt", String(phMin, 1));
        sendText("t1.txt", String(phMax, 1));
        sendText("t2.txt", String(ecMin, 1));
        sendText("t3.txt", String(ecMax, 1));
        sendText("t4.txt", String(tempMin, 1));
        sendText("t5.txt", String(tempMax, 1));
        sendText("t6.txt", String(humMin, 1));
        sendText("t7.txt", String(humMax, 1));
        sendText("t8.txt", String(timeBom));
        sendText("t9.txt", String(timeNghi));
      } else if (cmdUpper == "ABOUT_READY=") {
        updateWiFiIcon();
      } else if (cmdUpper == "CONTROL_READY=") {
        updateWiFiIcon();
        if (systemMode == 1) {
          sendValue("page3.bt10.val", 1);
          sendValue("page3.bt9.val", 0);
        } else if (systemMode == 0) {
          sendValue("page3.bt10.val", 0);
          sendValue("page3.bt9.val", 1);
        }
      }
      // G. DỪNG KHẨN CẤP
      else if (cmdUpper == "CMD=ESTOP" || cmdUpper.startsWith("DUNGKHANCAP")) {
        sendLoRaCommand("<ESTOP>");
        bom1State = false;
        van1State = false;
        autoState = AUTO_IDLE;
        updateDashboard();
      }
      // --- H. LƯU NGƯỠNG CÀI ĐẶT (TỪ TRANG SETTINGS) ---
      else if (cmdUpper.startsWith("SAVE=")) {
        // Lưu ý: cmd gốc giữ nguyên chữ hoa/thường của dữ liệu, cmdUpper dùng để so sánh lệnh
        String data = cmd.substring(5);

        preferences.begin("system_data", false);  // bắt buộc, nếu không put* không ghi được gì
        preferences.putFloat("phMin", getValue(data, ',', 0).toFloat());
        preferences.putFloat("phMax", getValue(data, ',', 1).toFloat());
        preferences.putFloat("ecMin", getValue(data, ',', 2).toFloat());
        preferences.putFloat("ecMax", getValue(data, ',', 3).toFloat());
        preferences.putFloat("tempMin", getValue(data, ',', 4).toFloat());
        preferences.putFloat("tempMax", getValue(data, ',', 5).toFloat());
        preferences.putFloat("humMin", getValue(data, ',', 6).toFloat());
        preferences.putFloat("humMax", getValue(data, ',', 7).toFloat());
        preferences.putInt("timeBom", getValue(data, ',', 8).toInt());
        preferences.putInt("timeNghi", getValue(data, ',', 9).toInt());

        // Đồng bộ thông số RAM hiện tại
        phMin = preferences.getFloat("phMin");
        phMax = preferences.getFloat("phMax");
        ecMin = preferences.getFloat("ecMin");
        ecMax = preferences.getFloat("ecMax");
        tempMin = preferences.getFloat("tempMin");
        tempMax = preferences.getFloat("tempMax");
        humMin = preferences.getFloat("humMin");
        humMax = preferences.getFloat("humMax");
        timeBom = preferences.getInt("timeBom");
        timeNghi = preferences.getInt("timeNghi");
        preferences.end();

        // Bắn lệnh đóng gói qua LoRa cho STM32 / Nano
        sendLoRaCommand("<SET_DATA=" + data + ">");
        Serial.println(">> [SETTINGS] Đã lưu ngưỡng vào Flash và gửi LoRa: " + data);
      }
      // --- KHỞI ĐỘNG LẠI HỆ THỐNG ---
      else if (cmdUpper == "CMD=REBOOT") {
        Serial.println(">> [SYSTEM] Nhận lệnh khởi động lại từ màn hình HMI!");
        updateOLED("SYSTEM", "Rebooting...");

        // Bắn thêm một lệnh qua LoRa nếu bạn muốn trạm dưới cũng khởi động lại (Tùy chọn)
        // sendLoRaCommand("<REBOOT>");

        // ĐÁ VĂNG MÀN HÌNH NEXTION VỀ TRANG ĐĂNG NHẬP (PAGE0)
        sendNextionCmd("page page0");

        delay(1000);    // Chờ 1 giây để lệnh Nextion kịp chạy xong
        ESP.restart();  // Lệnh ép ESP32 khởi động lại cứng (tương đương bấm nút EN)
      }
      // --- KHÔI PHỤC CÀI ĐẶT GỐC (CHUẨN CÂY CHÔM CHÔM) ---
      else if (cmdUpper == "CMD=RESTORE") {
        Serial.println(">> [SYSTEM] Đang khôi phục cài đặt gốc cho Chôm Chôm...");
        updateOLED("SYSTEM", "Restoring...");

        // 1. Lưu đè các thông số chuẩn Chôm Chôm vào Flash
        preferences.begin("system_data", false);
        preferences.putFloat("phMin", 5.5);
        preferences.putFloat("phMax", 6.5);
        preferences.putFloat("ecMin", 1.0);
        preferences.putFloat("ecMax", 2.0);
        preferences.putFloat("tempMin", 22.0);
        preferences.putFloat("tempMax", 35.0);
        preferences.putFloat("humMin", 65.0);
        preferences.putFloat("humMax", 80.0);

        // Khuyến nghị: Bơm chạy 10 phút, nghỉ 15 phút để nước thấm sâu tránh tràn
        preferences.putInt("timeBom", 10);
        preferences.putInt("timeNghi", 15);
        preferences.end();

        // 2. Cập nhật lại các biến đang chạy trong RAM
        phMin = 5.5;
        phMax = 6.5;
        ecMin = 1.0;
        ecMax = 2.0;
        tempMin = 22.0;
        tempMax = 35.0;
        humMin = 65.0;
        humMax = 80.0;
        timeBom = 10;
        timeNghi = 15;

        // 3. Gửi lệnh ép các ô chữ trên Nextion hiển thị số mới
        sendText("t0.txt", "5.5");
        sendText("t1.txt", "6.5");
        sendText("t2.txt", "1.0");
        sendText("t3.txt", "2.0");
        sendText("t4.txt", "22.0");
        sendText("t5.txt", "35.0");
        sendText("t6.txt", "65.0");
        sendText("t7.txt", "80.0");
        sendText("t8.txt", "10");
        sendText("t9.txt", "15");

        // 4. Bắn một gói lệnh xuống cho STM32 / Nano
        String defaultData = "5.5,6.5,1.0,2.0,22.0,35.0,65.0,80.0,10,15";
        sendLoRaCommand("<SET_DATA=" + defaultData + ">");

        Serial.println(">> [SYSTEM] Khôi phục thành công!");
      }
      }  // đóng: if (cmd.length() > 0)
    }  // <--- ĐÓNG NGOẶC HÀM nextion.available() Ở ĐÂY LÀ CHÍNH XÁC NHẤT!

    // ===============================================================
    // --- 5. LORA RETRY CƠ CHẾ CHỜ PHẢN HỒI (ACK) TỪ NANO ---
    // ===============================================================
    // Khối này phải nằm độc lập bên ngoài để luôn được quét mỗi vòng loop
    if (isWaitingAck && (millis() - lastSendTime >= TIMEOUT_MS)) {
      retryCount++;
      if (retryCount <= MAX_RETRIES) {
        loraSerial.println(currentCommand);
        lastSendTime = millis();
      } else {
        isWaitingAck = false;
      }
    }
  }