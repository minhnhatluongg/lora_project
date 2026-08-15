#include <HardwareSerial.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include "time.h"
#include <Preferences.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
Preferences preferences;

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

// ===================== CẤU HÌNH WIFI & NTP =====================
const char* ssid = "DESKTOP-2GO7JB8 5238";
const char* password = "78U5%g77kkkkk";
const char* ntpServer = "time.google.com";
const long gmtOffset_sec = 7 * 3600;
const int daylightOffset_sec = 0;
const char* BACKEND_BASE = "http://192.168.137.206:4000"; // THAY ĐỔI IP CHO KHỚP MÁY CHẠY BACKEND
//const char* DEVICE_API_KEY = "farm-secret-123";        // Phải khớp với backend/.env
const char* DEVICE_API_KEY = "changeme-esp32-secret";
const uint16_t HTTP_CONNECT_TIMEOUT_MS = 1500;
const uint16_t HTTP_TIMEOUT_MS = 2500;

int pendingWebCmdId = -1;     // Lưu ID lệnh Web đang chờ Nano xác nhận
unsigned long lastWebPoll = 0; // Hẹn giờ hỏi lệnh Web
// ===================== BIẾN HỆ THỐNG & MẬT KHẨU =====================
String systemPassword;
unsigned long lastUpdate = 0;
int systemMode = -1;  // -1: Chưa chọn | 0: Manual | 1: Auto

// ---> BIẾN LƯU TRẠNG THÁI BƠM/VAN <---
// Trạng thái DỪNG KHẨN CẤP mà web đang yêu cầu — giữ lại để chỉ phát <ESTOP>
// một lần ở cạnh lên, thay vì mỗi lần hỏi /api/status.
bool webEStopEngaged = false;

bool pumpState[5]  = { false, false, false, false, false };
bool valveState[4] = { false, false, false, false };
bool bom1State = false; // Giữ lại cho tương thích code cũ
bool van1State = false; 

unsigned long lastStatePush = 0;
const unsigned long STATE_PUSH_INTERVAL = 5000; // 5 giây báo cáo trạng thái lên Web 1 lần
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
float Dist4 = 0.0;  // Bồn TRỘN — ánh xạ chốt theo dây: Dist3 = Nước, Dist4 = Trộn

// ---> BỔ SUNG BIẾN CẢM BIẾN MƯA & KHÔNG KHÍ <---
int RainPercent = 0;  // % Mưa (0% = Khô, 100% = Mưa to)
float AirTemp = 0.0;  // Nhiệt độ không khí (°C)
float AirHum = 0.0;   // Độ ẩm không khí (%)

// --- NGƯỠNG CÀI ĐẶT ---
// ecMin/ecMax tính bằng µS/cm — CÙNG ĐƠN VỊ với EC_Value mà đầu dò RS485 trả
// về, và cùng đơn vị backend lưu. Trước đây hai biến này mặc định 1.0 và 2.0
// (tức mS/cm) rồi đem so thẳng với EC_Value cỡ 1500, nên "EC_Value > ecMax"
// luôn đúng: máy pha phân kẹt vĩnh viễn ở bước châm thêm nước, không bao giờ
// bật isMixingReady, và do đó tưới tự động không bao giờ khởi động.
float phMin, phMax, ecMin, ecMax, tempMin, tempMax, humMin, humMax;
int timeBom, timeNghi;                // Đơn vị: Phút

// Ngưỡng EC mặc định, đổi ở đây nếu nhóm nông học chốt số khác.
const float EC_MIN_DEFAULT = 1000.0;  // = 1.0 mS/cm
const float EC_MAX_DEFAULT = 2000.0;  // = 2.0 mS/cm

// Nhận số EC ở bất kỳ đơn vị nào rồi trả về µS/cm.
//
// Cần vì hai đường: chip đã nạp firmware cũ còn giữ 1.0/2.0 trong Flash, và
// người vận hành quen tay có thể gõ "1.5" trên màn Nextion. Không có dung dịch
// tưới thật nào chỉ 50 µS/cm (gần bằng nước cất), nên dưới ngưỡng đó chắc chắn
// là người ta đang nói mS/cm. Backend cũng dùng đúng phép suy luận này.
float ecToMicro(float v) {
  return (v > 0.0 && v < 50.0) ? v * 1000.0 : v;
}
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

  while (digitalRead(LORA_AUX) == LOW) { delay(5); }

  loraSerial.println(cmd);
  lastSendTime = millis();

  Serial.print("  [LORA TX -> NANO] Gửi lệnh: ");
  Serial.println(cmd);
  updateOLED("GUI LENH LORA:", cmd);
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
  sendText("t6.txt", String(Dist1, 1));  // t6: Bồn Đạm (Dist1)
  sendText("t7.txt", String(Dist2, 1));  // t7: Bồn Kali (Dist2)
  sendText("t8.txt", String(Dist3, 1));  // t8: Bồn Nước (Dist3)
  sendText("t9.txt", String(Dist4, 1));  // t9: Bồn Trộn (Dist4)

  // ---> 2. GỬI 3 THÔNG SỐ CẢM BIẾN MỚI LÊN DASHBOARD (t10, t11, t12) <---
  
  // Xử lý chuyển đổi % Mưa thành Chữ
  String rainStatus = "";
  if (RainPercent < 10) {
    rainStatus = "Không mưa";
  } else if (RainPercent < 40) {
    rainStatus = "Mưa nhỏ";
  } else if (RainPercent < 70) {
    rainStatus = "Mưa vừa";
  } else {
    rainStatus = "Mưa to";
  }

  sendText("t12.txt", rainStatus);           // t12: Hiển thị chữ trạng thái mưa
  sendText("t11.txt", String(AirTemp, 1));   // t11: Nhiệt độ không khí
  sendText("t10.txt", String(AirHum, 1));    // t10: Độ ẩm không khí


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
      if (!isMixingReady && Dist3 < WATER_EMPTY_DIST) {
        Serial.println(">> [MIXER] Bắt đầu quy trình pha phân bón...");
        mixState = MIX_ADD_WATER;
      }
      break;

    case MIX_ADD_WATER:
      // Dist4 là cảm biến siêu âm bồn TRỘN (khoảng cách > 50cm là cạn, cần bơm)
      if (Dist4 > 50.0 && Dist4 != -1.0) {
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
  bool isTankEmpty = (Dist3 > WATER_EMPTY_DIST && Dist3 != -1.0);
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
// HÀM GIAO TIẾP WEB BACKEND (HTTP API)
// =======================================================
void beginRequest(HTTPClient& http, const char* path) {
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);
  http.begin(String(BACKEND_BASE) + path);
  http.addHeader("x-api-key", DEVICE_API_KEY);
}

void ackWebCommand(int id, bool success) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  beginRequest(http, (String("/api/commands/") + id + "/ack").c_str());
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(success ? "{\"success\":true}" : "{\"success\":false}");
  Serial.printf(">> [WEB] Đã gửi ACK cho lệnh #%d -> Phản hồi API: %d\n", id, code);
  http.end();
}
void pushSettingsToWeb() {
  if (WiFi.status() != WL_CONNECTED) return;

  // Đóng gói 10 thông số thành chuỗi JSON
  StaticJsonDocument<512> doc;
  doc["phMin"] = phMin;
  doc["phMax"] = phMax;
  doc["ecMin"] = ecMin;
  doc["ecMax"] = ecMax;
  doc["tempMin"] = tempMin;
  doc["tempMax"] = tempMax;
  doc["humMin"] = humMin;
  doc["humMax"] = humMax;
  doc["timeBom"] = timeBom;
  doc["timeNghi"] = timeNghi;
  
  String body;
  serializeJson(doc, body);

  HTTPClient http;
  beginRequest(http, "/api/config/thresholds"); // (Bạn nhớ check lại Endpoint API này bên Backend nhé)
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  Serial.printf(">> [WEB] Đã đồng bộ Settings lên máy chủ -> Code: %d\n", code);
  http.end();
}
void postTelemetryToWeb() {
  if (WiFi.status() != WL_CONNECTED) return;
  
  StaticJsonDocument<512> doc;
  doc["temperature"] = Temperature;
  doc["humidity"] = Humidity;
  doc["ph"] = pH_Value;
  doc["ec"] = EC_Value;
  doc["n"] = Nitrogen;
  doc["p"] = Phosphorus;
  doc["k"] = Potassium;
  doc["dist1"] = Dist1;
  doc["dist2"] = Dist2;
  doc["dist3"] = Dist3;
  doc["dist4"] = Dist4;
  doc["air_temp"] = AirTemp;
  doc["air_hum"] = AirHum;
  doc["rain"] = RainPercent;
  
  doc["lora_rssi"] = WiFi.RSSI(); // Lấy tạm RSSI WiFi làm thông số sóng
  doc["slave_online"] = (lastLoraRxTime > 0) && (millis() - lastLoraRxTime < LORA_ONLINE_TIMEOUT);
  doc["sensor_status"] = "OK";

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  beginRequest(http, "/api/telemetry");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  Serial.printf(">> [WEB] Đã đẩy dữ liệu cảm biến (POST) -> Phản hồi API: %d\n", code);
  http.end();
}
void pushDeviceStateToWeb() {
  if (WiFi.status() != WL_CONNECTED) return;
  
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
  beginRequest(http, "/api/devices/state");
  http.addHeader("Content-Type", "application/json");
  http.POST(body);
  http.end();
}
// Đọc /api/status để biết web có đang bấm DỪNG KHẨN CẤP không.
//
// Không đi qua hàng đợi lệnh: dừng khẩn cấp phải tới nơi kể cả khi hàng đợi
// đang tắc hay ESP32 vừa khởi động lại. Một gói <ESTOP> cắt sạch 10 relay.
void syncEStopFromBackend() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  beginRequest(http, "/api/status");
  int code = http.GET();
  if (code == 200) {
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, http.getString()) == DeserializationError::Ok) {
      bool engaged = doc["eStop"] | false;
      // Chỉ hành động ở cạnh lên/xuống, không phát <ESTOP> mỗi 3 giây.
      if (engaged && !webEStopEngaged) {
        Serial.println(">> [WEB] DỪNG KHẨN CẤP — cắt toàn bộ relay");
        sendLoRaCommand("<ESTOP>");
        for (int i = 0; i < 5; i++) pumpState[i] = false;
        for (int i = 0; i < 4; i++) valveState[i] = false;
        bom1State = false;
        van1State = false;
        autoState = AUTO_IDLE;
        mixState  = MIX_IDLE;
        systemMode = 0;
        updateOLED("DUNG KHAN CAP", "Lenh tu Web");
        updateDashboard();
      }
      webEStopEngaged = engaged;
    }
  }
  http.end();
}

void pollWebCommands() {
  // Chỉ hỏi lệnh khi WiFi ổn định và LoRa đang KHÔNG bận chờ ACK
  if (WiFi.status() != WL_CONNECTED || isWaitingAck) return;

  HTTPClient http;
  beginRequest(http, "/api/commands/pending?limit=1");
  int code = http.GET();
  
  if (code == 200) {
    StaticJsonDocument<1024> doc;
    deserializeJson(doc, http.getString());
    
    for (JsonObject cmd : doc.as<JsonArray>()) {
      int id = cmd["id"];
      String devId = cmd["device_id"].as<String>();
      String action = cmd["action"].as<String>();

      Serial.printf(">> [WEB] Lệnh mới: ID=%d, Thiết bị=%s, Hành động=%s\n", id, devId.c_str(), action.c_str());

      bool isON = (action == "ON");
      int relayPin = -1;

      // Xử lý logic thiết bị (Map pump/van sang chân Relay của Nano)
      if (devId.startsWith("pump")) {
        int num = devId.substring(4).toInt(); // Lấy số 1-5
        relayPin = num;
        if (num == 1) bom1State = isON;
      } 
      else if (devId.startsWith("van")) {
        int num = devId.substring(3).toInt(); // Lấy số 1-4
        relayPin = num + 5;
        if (num == 1) van1State = isON;
      } 
      else if (devId == "mode") {
        systemMode = (action == "AUTO") ? 1 : 0;
        bom1State = false;
        van1State = false;
        // Nano phải biết để bật/tắt KHÓA AN TOÀN của nó, nếu không nút cơ dưới
        // tủ vẫn bấm được trong khi web tưởng đang ở TỰ ĐỘNG.
        sendLoRaCommand("<SET_MODE=" + action + ">");
        sendValue("page3.bt10.val", systemMode == 1 ? 1 : 0);
        sendValue("page3.bt9.val",  systemMode == 1 ? 0 : 1);
      }

      // Ở TỰ ĐỘNG, Nano từ chối mọi lệnh tay ("KHÓA AN TOÀN" trong nano_relay).
      // Nếu vẫn gửi rồi báo thành công thì dashboard sẽ vẽ một cái bơm ĐANG BẬT
      // mà ngoài đồng không hề chạy. Báo hỏng để backend giữ nguyên trạng thái.
      if (relayPin != -1 && systemMode == 1) {
        Serial.println("     -> đang ở TỰ ĐỘNG, từ chối lệnh tay từ web");
        ackWebCommand(id, false);
        continue;
      }

      // ---> LUẬT ĐỒNG BỘ: CẬP NHẬT TRẠNG THÁI RA MÀN NEXTION NGAY LẬP TỨC <---
      updateDashboard();

      if (relayPin != -1) {
        String loraCmd = isON ? "<ON" + String(relayPin) + ">" : "<OFF" + String(relayPin) + ">";
        sendLoRaCommand(loraCmd);

        // 1. Cập nhật mảng lưu trữ
        if (relayPin >= 1 && relayPin <= 5) pumpState[relayPin - 1] = isON;
        if (relayPin >= 6 && relayPin <= 9) valveState[relayPin - 6] = isON;

        // 2. ÉP NÚT TRÊN MÀN HÌNH NEXTION CHUYỂN MÀU THEO
        int nextionVal = isON ? 1 : 0;
        if (relayPin >= 1 && relayPin <= 5) {
          sendValue("page3.bt" + String(relayPin - 1) + ".val", nextionVal);
        } else if (relayPin >= 6 && relayPin <= 9) {
          sendValue("page3.bt" + String(relayPin - 1) + ".val", nextionVal); 
        }

        // 3. Báo cáo ngay lên Web để giao diện mượt hơn
        pushDeviceStateToWeb();
      }

      // Lưu ID lại để lát nữa Nano báo ACK thì mới báo thành công lên Web
      pendingWebCmdId = id; 
    }
  }
  http.end();
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
  // end() must come AFTER the last read. Closing here (as this block used to)
  // left every getFloat below reading a shut handle, so the ten thresholds an
  // operator saved on the Nextion silently reverted to these defaults on every
  // boot. The save path further down already gets this right.
  preferences.begin("system_data", false);
  systemPassword = preferences.getString("password", "123456");
  Serial.println(">> [PREFERENCES] Mật khẩu hệ thống hiện tại: " + systemPassword);

  phMin = preferences.getFloat("phMin", 5.5);
  phMax = preferences.getFloat("phMax", 6.5);
  // ecToMicro: chip từng nạp firmware cũ còn giữ 1.0/2.0 trong Flash.
  ecMin = ecToMicro(preferences.getFloat("ecMin", EC_MIN_DEFAULT));
  ecMax = ecToMicro(preferences.getFloat("ecMax", EC_MAX_DEFAULT));
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

      updateDashboard();  // Đẩy toàn bộ số liệu mới lên HMI
      postTelemetryToWeb();
    }

   // B. Xử lý gói ACK xác nhận lệnh từ Arduino Nano (<ACK_...>)
    if (isWaitingAck) {
      String expectedAck = "<ACK_" + currentCommand.substring(1);
      if (incomingData.indexOf(expectedAck) != -1) {
        Serial.println("  [LORA RX <- NANO] Nhận ACK phản hồi thành công: " + expectedAck);
        updateOLED("TRANG THAI: OK", "Lenh: " + currentCommand);
        isWaitingAck = false;

        // ---> BỔ SUNG: NẾU LỆNH ĐÓ LÀ CỦA WEB YÊU CẦU, HÃY BÁO LẠI CHO WEB <---
        if (pendingWebCmdId != -1) {
          ackWebCommand(pendingWebCmdId, true);
          pendingWebCmdId = -1; // Xóa ID lệnh sau khi xử lý xong
        }
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
            sendValue("page3.bt" + String(num - 1) + ".val", nextionVal);
          } else if (devName.startsWith("VAN")) {
            int num = devName.substring(3).toInt();  // Lấy số 1 đến 4
            if (num == 1) van1State = isOn;
            sendValue("page3.bt" + String(num + 4) + ".val", nextionVal);
          }
          updateDashboard();
        }
      }
    }
  }
    if (millis() - lastWebPoll >= 3000) {
    lastWebPoll = millis();
    // Dừng khẩn cấp phải được kiểm TRƯỚC khi nhận lệnh mới — nếu web vừa bấm
    // cắt thì không có lý gì đi bật thêm một relay nữa trong cùng vòng quét.
    syncEStopFromBackend();
    pollWebCommands();
    }
  if (millis() - lastStatePush >= STATE_PUSH_INTERVAL) {
    lastStatePush = millis();
    pushDeviceStateToWeb();
  }

    // ===============================================================
    // --- 4. XỬ LÝ LỆNH TỪ MÀN HÌNH HMI NEXTION ---
    // ===============================================================
    if (nextion.available()) {
      String cmd = nextion.readStringUntil('\n');
      cmd.trim();
      // Was `return`, which bailed out of loop() entirely — one stray byte from
      // the Nextion skipped the LoRa retry block further down. Skip the byte,
      // not the rest of the cycle.
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
        String data = cmd.substring(5);

        // BẮT BUỘC PHẢI CÓ DÒNG NÀY ĐỂ MỞ BỘ NHỚ FLASH TRƯỚC KHI LƯU
        preferences.begin("system_data", false);

        preferences.putFloat("phMin", getValue(data, ',', 0).toFloat());
        preferences.putFloat("phMax", getValue(data, ',', 1).toFloat());
        // Quy về µS/cm ngay tại cửa vào, để Flash chỉ chứa một đơn vị duy nhất
        // dù người vận hành gõ "1.5" hay "1500" trên màn Nextion.
        preferences.putFloat("ecMin", ecToMicro(getValue(data, ',', 2).toFloat()));
        preferences.putFloat("ecMax", ecToMicro(getValue(data, ',', 3).toFloat()));
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

        // ĐÓNG BỘ NHỚ SAU KHI LƯU XONG
        preferences.end();

        // 1. Gửi xuống LoRa cho tủ điện
        sendLoRaCommand("<SET_DATA=" + data + ">");
        Serial.println(">> [SETTINGS] Đã lưu ngưỡng vào Flash và gửi LoRa: " + data);

        // 2. BẮN LÊN ĐỒNG BỘ CHO WEB BACKEND
        pushSettingsToWeb();
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
        preferences.begin("system_data", false);
        // 1. Lưu đè các thông số chuẩn Chôm Chôm vào Flash
        preferences.putFloat("phMin", 5.5);
        preferences.putFloat("phMax", 6.5);
        preferences.putFloat("ecMin", EC_MIN_DEFAULT);
        preferences.putFloat("ecMax", EC_MAX_DEFAULT);
        preferences.putFloat("tempMin", 22.0);
        preferences.putFloat("tempMax", 35.0);
        preferences.putFloat("humMin", 65.0);
        preferences.putFloat("humMax", 80.0);

        // Khuyến nghị: Bơm chạy 10 phút, nghỉ 15 phút để nước thấm sâu tránh tràn
        preferences.putInt("timeBom", 10);
        preferences.putInt("timeNghi", 15);
        // ĐÓNG FLASH SAU KHI LƯU XONG
        preferences.end();
        // 2. Cập nhật lại các biến đang chạy trong RAM
        phMin = 5.5;
        phMax = 6.5;
        ecMin = EC_MIN_DEFAULT;
        ecMax = EC_MAX_DEFAULT;
        tempMin = 22.0;
        tempMax = 35.0;
        humMin = 65.0;
        humMax = 80.0;
        timeBom = 10;
        timeNghi = 15;

        // 3. Gửi lệnh ép các ô chữ trên Nextion hiển thị số mới
        sendText("t0.txt", "5.5");
        sendText("t1.txt", "6.5");
        // Cùng dạng với trang SETTINGS (String(ecMin, 1)), đơn vị µS/cm.
        sendText("t2.txt", String(EC_MIN_DEFAULT, 1));
        sendText("t3.txt", String(EC_MAX_DEFAULT, 1));
        sendText("t4.txt", "22.0");
        sendText("t5.txt", "35.0");
        sendText("t6.txt", "65.0");
        sendText("t7.txt", "80.0");
        sendText("t8.txt", "10");
        sendText("t9.txt", "15");

        // 4. Bắn một gói lệnh xuống cho STM32 / Nano
        String defaultData = "5.5,6.5," + String(EC_MIN_DEFAULT, 1) + "," +
                             String(EC_MAX_DEFAULT, 1) + ",22.0,35.0,65.0,80.0,10,15";
        sendLoRaCommand("<SET_DATA=" + defaultData + ">");

        Serial.println(">> [SYSTEM] Khôi phục thành công!");
      }
      }  // đóng if (cmd.length() > 0) — byte rác bị bỏ qua, không thoát loop()
    }    // đóng if (nextion.available())

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