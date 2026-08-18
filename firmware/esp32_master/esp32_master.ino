#include <HardwareSerial.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include "time.h"
#include <Preferences.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// =======================================================
// OBJECTS
// =======================================================
Preferences preferences;
HardwareSerial loraSerial(1);
HardwareSerial nextion(2);

// =======================================================
// OLED
// =======================================================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C
#define I2C_SDA 9
#define I2C_SCL 10
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// =======================================================
// LORA
// =======================================================
#define LORA_M0 5
#define LORA_M1 6
#define LORA_AUX 8
#define LORA_RX_PIN 18
#define LORA_TX_PIN 17

// =======================================================
// NEXTION
// =======================================================
#define NEXTION_RX 12
#define NEXTION_TX 11

// =======================================================
// WIFI
// =======================================================
const char* ssid = "DESKTOP-2GO7JB8 5238";
const char* password = "78U5%g77kkkkk";
const char* ntpServer = "time.google.com";
const long gmtOffset_sec = 7 * 3600;
const int daylightOffset_sec = 0;

// =======================================================
// BACKEND
// =======================================================
const char* BACKEND_BASE = "http://192.168.137.206:4000";
const char* DEVICE_API_KEY = "changeme-esp32-secret";
const uint16_t HTTP_CONNECT_TIMEOUT_MS = 1500;
const uint16_t HTTP_TIMEOUT_MS = 2500;

// =======================================================
// FREE RTOS
// =======================================================
TaskHandle_t webTaskHandle = NULL;

// =======================================================
// MUTEX
// =======================================================
SemaphoreHandle_t systemMutex = NULL;
SemaphoreHandle_t queueMutex = NULL;

// =======================================================
// WEB EVENT FLAGS
// =======================================================
volatile bool telemetryPending = false;
volatile bool settingsPending = false;
volatile bool deviceStatePending = false;
// Che do hoac buoc may trang thai vua doi -> bao len web o vong web ke tiep.
volatile bool statusReportPending = false;
bool lastWiFiState = false; 
volatile bool wifiUIUpdatePending = false;

// =======================================================
// WEB ACK EVENT
// =======================================================
int webCommandId = -1;
volatile bool webAckPending = false;
int webAckId = -1;
bool webAckSuccess = false;

// =======================================================
// WEB TIMERS
// =======================================================
unsigned long lastWebPoll = 0;
const unsigned long WEB_POLL_INTERVAL = 3000UL;
unsigned long lastTelemetryPost = 0;
const unsigned long TELEMETRY_INTERVAL = 3000UL;
unsigned long lastStatePush = 0;
const unsigned long STATE_PUSH_INTERVAL = 5000UL;

// =======================================================
// SYSTEM
// =======================================================
String systemPassword;
unsigned long lastUpdate = 0;
int systemMode = -1;  // -1: chưa chọn | 0: MANUAL | 1: AUTO

// =======================================================
// RELAY STATES
// =======================================================
// --- DON VI EC ---------------------------------------------------------------
// EC_Value tu dau do RS485 la uS/cm (co 1500). Nguong ecMin/ecMax truoc day mac
// dinh 1.0 va 2.0 tuc mS/cm, roi dem so THANG voi EC_Value. "EC_Value > ecMax"
// thanh ra LUON dung: may pha phan ket vinh vien o buoc pha loang, khong bao gio
// bat isMixingReady, nen tuoi tu dong khong bao gio khoi dong.
// Giu nguyen y dinh nong hoc (1.0 va 2.0 mS/cm), chi doi don vi cho khop.
const float EC_MIN_DEFAULT = 1000.0;  // = 1.0 mS/cm
const float EC_MAX_DEFAULT = 2000.0;  // = 2.0 mS/cm

// Nhan so EC o bat ky don vi nao roi tra ve uS/cm. Can vi chip da nap firmware
// cu con giu 1.0/2.0 trong Flash, va nguoi van hanh quen tay co the go "1.5".
// Khong dung dich tuoi nao chi 50 uS/cm (gan bang nuoc cat) nen duoi nguong do
// chac chan la dang noi mS/cm. Backend cung dung dung phep suy luan nay.
float ecToMicro(float v) {
  return (v > 0.0 && v < 50.0) ? v * 1000.0 : v;
}

bool pumpState[5] = {false, false, false, false, false};
bool valveState[4] = {false, false, false, false};
bool bom1State = false;
bool van1State = false;

// =======================================================
// LORA ONLINE
// =======================================================
unsigned long lastLoraRxTime = 0;
const unsigned long LORA_ONLINE_TIMEOUT = 180000UL;

// Dữ liệu cảm biến được coi là "hợp lệ" chỉ khi đã từng nhận được từ STM32
// VÀ lần nhận gần nhất còn nằm trong khung LORA_ONLINE_TIMEOUT.
// Dùng để chặn AUTO chạy dựa trên dữ liệu mặc định (0.0) lúc mới khởi động.
bool isSensorDataValid() {
  return (lastLoraRxTime > 0 && millis() - lastLoraRxTime < LORA_ONLINE_TIMEOUT);
}

// =======================================================
// SENSOR
// =======================================================
float Temperature = 0.0;
float Humidity = 0.0;
uint16_t EC_Value = 0;
float pH_Value = 0.0;
uint16_t Nitrogen = 0;
uint16_t Phosphorus = 0;
uint16_t Potassium = 0;
float Dist1 = 0.0;
float Dist2 = 0.0;
float Dist3 = 0.0;
float Dist4 = 0.0;
int RainPercent = 0;
float AirTemp = 0.0;
float AirHum = 0.0;

// =======================================================
// SETTINGS
// =======================================================
float phMin, phMax;
float ecMin, ecMax;
float tempMin, tempMax;
float humMin, humMax;
int timeBom, timeNghi;

// =======================================================
// SAFETY
// =======================================================
const float WATER_EMPTY_DIST = 80.0;
const int RAIN_MAX_PERCENT = 50;

// =======================================================
// COMMAND QUEUE
// =======================================================
const int QUEUE_SIZE = 15;
String cmdQueue[QUEUE_SIZE];
int queueHead = 0;
int queueTail = 0;

// =======================================================
// LORA ACK
// =======================================================
unsigned long lastSendTime = 0;
const unsigned long TIMEOUT_MS = 2000UL;
const int MAX_RETRIES = 3;
int retryCount = 0;
String currentCommand = "";
bool isWaitingAck = false;

// =======================================================
// POLL STM32 (thay cho việc STM32 tự phát định kỳ)
// =======================================================
unsigned long lastStm32PollTime = 0;
const unsigned long STM32_POLL_INTERVAL = 3000UL; // hỏi STM32 mỗi 3s khi rảnh

// =======================================================
// ESTOP PRIORITY (gửi trực tiếp, không qua hàng đợi Queue+ACK thông thường)
// =======================================================
const char* EMERGENCY_COMMAND = "<ESTOP>";

// =======================================================
// AUTO IRRIGATION STATE
// =======================================================
enum AutoState {
  AUTO_IDLE, AUTO_OPEN_VALVE, AUTO_WAIT_VALVE, AUTO_START_PUMP, 
  AUTO_IRRIGATING, AUTO_STOP_PUMP, AUTO_WAIT_PUMP_OFF, AUTO_CLOSE_VALVE, AUTO_RESTING
};
AutoState autoState = AUTO_IDLE;
unsigned long autoStateTimer = 0;

// =======================================================
// AUTO MIXING STATE
// =======================================================
enum MixState {
  MIX_IDLE, MIX_ADD_WATER, MIX_PUMPING_WATER, MIX_DOSING_NUTRIENT,
  MIX_WAIT_DOSING, MIX_STIRRING, MIX_WAIT_STABLE
};
MixState mixState = MIX_IDLE;
unsigned long mixStateTimer = 0;
bool isMixingReady = false;

// =======================================================
// STRING HELPER
// =======================================================
String getValue(const String& data, char separator, int index) {
  int found = 0;
  int strIndex[] = {0, -1};
  int maxIndex = data.length() - 1;
  for (int i = 0; i <= maxIndex && found <= index; i++) {
    if (data.charAt(i) == separator || i == maxIndex) {
      found++;
      strIndex[0] = strIndex[1] + 1;
      strIndex[1] = (i == maxIndex) ? i + 1 : i;
    }
  }
  if (found > index) return data.substring(strIndex[0], strIndex[1]);
  return "";
}

// =======================================================
// NEXTION COMMANDS
// =======================================================
void sendNextionCmd(const String& cmd) {
  nextion.print(cmd);
  nextion.write(0xFF);
  nextion.write(0xFF);
  nextion.write(0xFF);
}
void sendText(const String& obj, const String& txt) {
  sendNextionCmd(obj + "=\"" + txt + "\"");
}
void sendValue(const String& obj, int val) {
  sendNextionCmd(obj + "=" + String(val));
}

// =======================================================
// OLED
// =======================================================
void updateOLED(const String& line1, const String& line2) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(line1);
  display.setCursor(0, 16);
  display.println(line2);
  display.display();
}

// =======================================================
// WIFI ICON
// =======================================================
void updateWiFiIcon() {
  bool connected = (WiFi.status() == WL_CONNECTED);
  int visible = connected ? 0 : 1;
  sendNextionCmd("vis pwifi," + String(visible));
}

// =======================================================
// DASHBOARD
// =======================================================
void updateDashboard() {
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

  String rainStatus;
  if (RainPercent < 10) rainStatus = "Không mưa";
  else if (RainPercent < 40) rainStatus = "Mưa nhỏ";
  else if (RainPercent < 70) rainStatus = "Mưa vừa";
  else rainStatus = "Mưa to";
  sendText("t12.txt", rainStatus);
  sendText("t11.txt", String(AirTemp, 1));
  sendText("t10.txt", String(AirHum, 1));
}

// =======================================================
// CẬP NHẬT TRẠNG THÁI NEXTION CONTROL
// =======================================================
void updateNextionControlStates() {
  if (systemMode == 1) {
    sendValue("page3.bt10.val", 1);
    sendValue("page3.bt9.val", 0);
  } else if (systemMode == 0) {
    sendValue("page3.bt10.val", 0);
    sendValue("page3.bt9.val", 1);
  } else {
    sendValue("page3.bt10.val", 0);
    sendValue("page3.bt9.val", 0);
  }
  xSemaphoreTake(systemMutex, portMAX_DELAY);
  for (int i = 0; i < 5; i++) {
    sendValue("page3.bt" + String(i) + ".val", pumpState[i] ? 1 : 0);
  }
  for (int i = 0; i < 4; i++) {
    sendValue("page3.bt" + String(i + 5) + ".val", valveState[i] ? 1 : 0);
  }
  xSemaphoreGive(systemMutex);
}

// =======================================================
// CLOCK
// =======================================================
void updateClock() {
  struct tm t;
  if (!getLocalTime(&t)) return;
  char str[20];
  snprintf(str, sizeof(str), "%02d:%02d:%02d", t.tm_hour, t.tm_min, t.tm_sec);
  sendText("time.txt", str);
  snprintf(str, sizeof(str), "%02d/%02d/%04d", t.tm_mday, t.tm_mon + 1, t.tm_year + 1900);
  sendText("date.txt", str);
}

// =======================================================
// QUEUE - CLEAR
// =======================================================
void clearCommandQueue() {
  if (queueMutex != NULL) {
    xSemaphoreTake(queueMutex, portMAX_DELAY);
  }
  queueHead = 0;
  queueTail = 0;
  for (int i = 0; i < QUEUE_SIZE; i++) {
    cmdQueue[i] = "";
  }
  if (queueMutex != NULL) {
    xSemaphoreGive(queueMutex);
  }
  Serial.println(">> [QUEUE] Đã xóa Queue.");
}

// =======================================================
// QUEUE - ENQUEUE
// =======================================================
bool enqueueCommand(const String& cmd) {
  if (cmd.length() == 0) return false;
  bool success = false;
  xSemaphoreTake(queueMutex, portMAX_DELAY);
  int nextTail = (queueTail + 1) % QUEUE_SIZE;
  if (nextTail != queueHead) {
    cmdQueue[queueTail] = cmd;
    queueTail = nextTail;
    success = true;
    Serial.println("  [QUEUE] + " + cmd);
  } else {
    Serial.println(">> [QUEUE] FULL -> DROP: " + cmd);
  }
  xSemaphoreGive(queueMutex);
  return success;
}

// =======================================================
// QUEUE - ENQUEUE LỆNH AUTO (state machine tự sinh)
// Dùng format <AUTOONx>/<AUTOOFFx> riêng biệt với lệnh tay <ONx>/<OFFx>,
// để Nano phân biệt được nguồn gốc lệnh khi áp dụng khóa an toàn cục bộ.
// =======================================================
bool enqueueAutoCommand(int relayNum, bool turnOn) {
  String cmd = turnOn ? "<AUTOON" + String(relayNum) + ">" : "<AUTOOFF" + String(relayNum) + ">";
  return enqueueCommand(cmd);
}

// =======================================================
// QUEUE - IS EMPTY
// =======================================================
bool isQueueEmpty() {
  bool empty;
  xSemaphoreTake(queueMutex, portMAX_DELAY);
  empty = (queueHead == queueTail);
  xSemaphoreGive(queueMutex);
  return empty;
}

// =======================================================
// ESTOP - gửi trực tiếp, KHÔNG qua hàng đợi Queue+ACK thông thường
// (trước đây bị "nuốt" trong enqueueCommand() và không bao giờ tới Nano)
// =======================================================
void sendEmergencyStopDirect() {
  for (int i = 0; i < 3; i++) {
    if (digitalRead(LORA_AUX) == HIGH) {
      loraSerial.println(EMERGENCY_COMMAND);
      Serial.println("  [LORA TX] ESTOP (fire " + String(i + 1) + "/3)");
      delay(30);
    }
  }
}

void enqueueEmergencyStop() {
  Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  Serial.println(">> [EMERGENCY] KICH HOAT ESTOP!");
  Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");

  clearCommandQueue();
  
  xSemaphoreTake(systemMutex, portMAX_DELAY);
  systemMode = 0; // Về Manual
  bom1State = false;
  van1State = false;
  for (int i = 0; i < 5; i++) pumpState[i] = false;
  for (int i = 0; i < 4; i++) valveState[i] = false;
  xSemaphoreGive(systemMutex);

  autoState = AUTO_IDLE;
  mixState = MIX_IDLE;
  isMixingReady = false;

  isWaitingAck = false;
  retryCount = 0;
  currentCommand = "";

  sendEmergencyStopDirect();
  for (int i = 1; i <= 9; i++) {
    enqueueCommand("<OFF" + String(i) + ">");
  }

  updateOLED("EMERGENCY STOP", "Dang ngat he thong");
  deviceStatePending = true;
  updateNextionControlStates();
}

// =======================================================
// WEB ACK EVENT
// =======================================================
void setWebAckResult(int id, bool success) {
  if (id < 0) return;
  xSemaphoreTake(systemMutex, portMAX_DELAY);
  webAckId = id;
  webAckSuccess = success;
  webAckPending = true;
  webCommandId = -1;
  xSemaphoreGive(systemMutex);
}

// =======================================================
// LORA QUEUE PROCESSOR
// =======================================================
void processLoRaQueue() {
  unsigned long now = millis();

  if (isWaitingAck) {
    if (now - lastSendTime >= TIMEOUT_MS) {
      retryCount++;
      if (retryCount <= MAX_RETRIES) {
        if (digitalRead(LORA_AUX) == HIGH) {
          loraSerial.println(currentCommand);
          lastSendTime = now;
          Serial.printf("  [LORA TX] RETRY %d/%d: %s\n", retryCount, MAX_RETRIES, currentCommand.c_str());
        }
      } else {
        Serial.println(">> [LORA] ACK TIMEOUT! Failed: " + currentCommand);
        if (webCommandId >= 0) {
          setWebAckResult(webCommandId, false);
        }
        isWaitingAck = false;
        retryCount = 0;
        currentCommand = "";
        updateOLED("LORA LOI", "ACK TIMEOUT");
        // Khong nghe thay Nano tra loi -> khong duoc phep doan la lenh da chay.
        updateNextionControlStates();
        deviceStatePending = true;
      }
    }
    return; 
  }

  String commandToSend = "";
  xSemaphoreTake(queueMutex, portMAX_DELAY);
  if (queueHead != queueTail) {
    if (digitalRead(LORA_AUX) == HIGH) {
      commandToSend = cmdQueue[queueHead];
      cmdQueue[queueHead] = "";
      queueHead = (queueHead + 1) % QUEUE_SIZE;
    }
  }
  xSemaphoreGive(queueMutex);

  if (commandToSend.length() == 0) return;

  currentCommand = commandToSend;
  loraSerial.println(currentCommand);
  lastSendTime = now;
  retryCount = 0;
  isWaitingAck = true;
  
  Serial.println("  [LORA TX] " + currentCommand);
  updateOLED("LORA TX:", currentCommand);
}

// =======================================================
// POLL STM32 KHI RẢNH (thay cho việc STM32 tự phát định kỳ,
// tránh va chạm sóng với giao dịch Queue+ACK ESP32<->Nano)
// =======================================================
void pollStm32IfIdle() {
  unsigned long now = millis();
  if (now - lastStm32PollTime < STM32_POLL_INTERVAL) return;
  if (isWaitingAck || !isQueueEmpty()) return;   // đang bận giao dịch với Nano -> chờ
  if (digitalRead(LORA_AUX) != HIGH) return;

  loraSerial.println("<REQ_DATA>");
  lastStm32PollTime = now;
  Serial.println("  [LORA TX] REQ_DATA -> STM32");
}

// =======================================================
// AUTO MIXING
// =======================================================
void handleAutoMixingLogic() {
  if (systemMode != 1 || !isSensorDataValid()) {
    mixState = MIX_IDLE;
    return;
  }
  unsigned long now = millis();
  switch (mixState) {
    case MIX_IDLE:
      if (!isMixingReady && Dist3 < WATER_EMPTY_DIST && Dist3 >= 0) {
        Serial.println(">> [MIX] START");
        mixState = MIX_ADD_WATER;
      }
      break;
    case MIX_ADD_WATER:
      if (Dist4 > 50.0 && Dist4 >= 0) {
        enqueueAutoCommand(3, true);
        mixState = MIX_PUMPING_WATER;
        Serial.println(">> [MIX] Pump 3 ON");
      } else {
        enqueueAutoCommand(3, false);
        mixStateTimer = now;
        mixState = MIX_WAIT_STABLE;
      }
      break;
    case MIX_PUMPING_WATER:
      if (Dist4 <= 50.0 && Dist4 >= 0) {
        enqueueAutoCommand(3, false);
        mixStateTimer = now;
        mixState = MIX_WAIT_STABLE;
        Serial.println(">> [MIX] Water ready");
      }
      break;
    case MIX_DOSING_NUTRIENT:
      if (!isWaitingAck && isQueueEmpty()) {
        if (EC_Value < ecMin) {
          Serial.printf(">> [MIX] EC thấp -> N + K\n");
          enqueueAutoCommand(1, true);
          enqueueAutoCommand(2, true);
          mixStateTimer = now;
          mixState = MIX_WAIT_DOSING;
        } else if (EC_Value > ecMax) {
          mixState = MIX_ADD_WATER;
        } else {
          isMixingReady = true;
          mixState = MIX_IDLE;
          Serial.println(">> [MIX] Nutrient OK");
        }
      }
      break;
    case MIX_WAIT_DOSING:
      if (now - mixStateTimer >= 3000UL && !isWaitingAck && isQueueEmpty()) {
        enqueueAutoCommand(1, false);
        enqueueAutoCommand(2, false);
        enqueueAutoCommand(4, true);
        mixStateTimer = now;
        mixState = MIX_STIRRING;
      }
      break;
    case MIX_STIRRING:
      if (now - mixStateTimer >= 10000UL && !isWaitingAck && isQueueEmpty()) {
        enqueueAutoCommand(4, false);
        mixStateTimer = now;
        mixState = MIX_WAIT_STABLE;
      }
      break;
    case MIX_WAIT_STABLE:
      if (now - mixStateTimer >= 5000UL && !isWaitingAck && isQueueEmpty()) {
        mixState = MIX_DOSING_NUTRIENT;
      }
      break;
  }
}

// =======================================================
// AUTO IRRIGATION
// =======================================================
void handleAutoIrrigationLogic() {
  if (systemMode != 1 || !isSensorDataValid()) {
    autoState = AUTO_IDLE;
    return;
  }
  bool tankEmpty = (Dist3 > WATER_EMPTY_DIST && Dist3 >= 0);
  bool heavyRain = RainPercent >= RAIN_MAX_PERCENT;

  if (tankEmpty || heavyRain) {
    if (autoState != AUTO_IDLE) {
      Serial.println(">> [AUTO] SAFETY STOP");
      enqueueAutoCommand(5, false);
      enqueueAutoCommand(6, false);
      autoState = AUTO_IDLE;
      updateOLED("CANH BAO", tankEmpty ? "BON CAN NUOC" : "TROI MUA TO");
    }
    return;
  }
  unsigned long now = millis();
  switch (autoState) {
    case AUTO_IDLE:
      if (Humidity <= humMin && Humidity > 0 && isMixingReady && !isWaitingAck && isQueueEmpty()) {
        autoState = AUTO_OPEN_VALVE;
      }
      break;
    case AUTO_OPEN_VALVE:
      enqueueAutoCommand(6, true);
      autoStateTimer = now;
      autoState = AUTO_WAIT_VALVE;
      break;
    case AUTO_WAIT_VALVE:
      if (now - autoStateTimer >= 2000UL && !isWaitingAck) {
        autoState = AUTO_START_PUMP;
      }
      break;
    case AUTO_START_PUMP:
      enqueueAutoCommand(5, true);
      autoStateTimer = now;
      autoState = AUTO_IRRIGATING;
      break;
    case AUTO_IRRIGATING:
      if (Humidity >= humMax || (now - autoStateTimer >= (unsigned long)timeBom * 60000UL)) {
        autoState = AUTO_STOP_PUMP;
      }
      break;
    case AUTO_STOP_PUMP:
      enqueueAutoCommand(5, false);
      autoStateTimer = now;
      autoState = AUTO_WAIT_PUMP_OFF;
      break;
    case AUTO_WAIT_PUMP_OFF:
      if (now - autoStateTimer >= 2000UL && !isWaitingAck) {
        autoState = AUTO_CLOSE_VALVE;
      }
      break;
    case AUTO_CLOSE_VALVE:
      enqueueAutoCommand(6, false);
      autoStateTimer = now;
      if (Humidity < humMax) {
        autoState = AUTO_RESTING;
      } else {
        autoState = AUTO_IDLE;
        isMixingReady = false;
      }
      break;
    case AUTO_RESTING:
      if (now - autoStateTimer >= (unsigned long)timeNghi * 60000UL) {
        autoState = AUTO_IDLE;
      }
      break;
  }
}

// =======================================================
// HTTP BEGIN
// =======================================================
bool beginRequest(HTTPClient& http, const char* path) {
  if (WiFi.status() != WL_CONNECTED) return false;
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);
  String url = String(BACKEND_BASE) + path;
  if (!http.begin(url)) {
    Serial.println(">> [WEB] HTTP begin FAILED");
    return false;
  }
  http.addHeader("x-api-key", DEVICE_API_KEY);
  return true;
}

// =======================================================
// ACK WEB COMMAND
// =======================================================
void ackWebCommand(int id, bool success) {
  if (id < 0 || WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String path = "/api/commands/" + String(id) + "/ack";
  if (!beginRequest(http, path.c_str())) return;
  http.addHeader("Content-Type", "application/json");
  const char* body = success ? "{\"success\":true}" : "{\"success\":false}";
  int code = http.POST(body);
  Serial.printf(">> [WEB] ACK #%d -> %d\n", id, code);
  http.end();
}

// =======================================================
// PUSH SETTINGS
// =======================================================
void pushSettingsToWeb() {
  if (WiFi.status() != WL_CONNECTED) return;
  DynamicJsonDocument doc(2048);
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
  if (!beginRequest(http, "/api/config/thresholds")) return;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  Serial.printf(">> [WEB] Settings -> %d\n", code);
  http.end();
}

// =======================================================
// TELEMETRY
// =======================================================
void postTelemetryToWeb() {
  if (WiFi.status() != WL_CONNECTED) return;
  float temperature, humidity, ph, d1, d2, d3, d4, airTemp, airHum;
  uint16_t ec, n, p, k;
  int rain;
  unsigned long lastLora;

  xSemaphoreTake(systemMutex, portMAX_DELAY);
  temperature = Temperature;
  humidity = Humidity;
  ph = pH_Value;
  ec = EC_Value;
  n = Nitrogen;
  p = Phosphorus;
  k = Potassium;
  d1 = Dist1; d2 = Dist2; d3 = Dist3; d4 = Dist4;
  rain = RainPercent;
  airTemp = AirTemp;
  airHum = AirHum;
  lastLora = lastLoraRxTime;
  xSemaphoreGive(systemMutex);

  DynamicJsonDocument doc(2048);
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["ph"] = ph;
  doc["ec"] = ec;
  doc["n"] = n;
  doc["p"] = p;
  doc["k"] = k;
  doc["dist1"] = d1;
  doc["dist2"] = d2;
  doc["dist3"] = d3;
  doc["dist4"] = d4;
  doc["air_temp"] = airTemp;
  doc["air_hum"] = airHum;
  doc["rain"] = rain;
  doc["slave_online"] = (lastLora > 0 && millis() - lastLora < LORA_ONLINE_TIMEOUT);
  doc["sensor_status"] = "OK";
  String body;
  serializeJson(doc, body);
  HTTPClient http;
  if (!beginRequest(http, "/api/telemetry")) return;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  Serial.printf(">> [WEB] Telemetry -> %d\n", code);
  http.end();
}

// =======================================================
// DEVICE STATE
// =======================================================
// Ten buoc cua hai may trang thai, gui nguyen van len web de man CONTROL ve
// duoc dai tien trinh thay vi chi mot chu "TU DONG" va may o xam.
//
// Tham so kieu int chu khong phai enum: Arduino tu sinh prototype cho moi ham
// trong file .ino roi CHEN LEN DAU file, truoc ca cho khai bao enum, nen de
// nguyen kieu AutoState se bao "was not declared in this scope".
const char * autoStateName(int s) {
  switch ((AutoState)s) {
    case AUTO_IDLE:          return "AUTO_IDLE";
    case AUTO_OPEN_VALVE:    return "AUTO_OPEN_VALVE";
    case AUTO_WAIT_VALVE:    return "AUTO_WAIT_VALVE";
    case AUTO_START_PUMP:    return "AUTO_START_PUMP";
    case AUTO_IRRIGATING:    return "AUTO_IRRIGATING";
    case AUTO_STOP_PUMP:     return "AUTO_STOP_PUMP";
    case AUTO_WAIT_PUMP_OFF: return "AUTO_WAIT_PUMP_OFF";
    case AUTO_CLOSE_VALVE:   return "AUTO_CLOSE_VALVE";
    case AUTO_RESTING:       return "AUTO_RESTING";
  }
  return "AUTO_IDLE";
}

const char * mixStateName(int s) {
  switch ((MixState)s) {
    case MIX_IDLE:            return "MIX_IDLE";
    case MIX_ADD_WATER:       return "MIX_ADD_WATER";
    case MIX_DOSING_NUTRIENT: return "MIX_DOSING_NUTRIENT";
    case MIX_STIRRING:        return "MIX_STIRRING";
    case MIX_WAIT_STABLE:     return "MIX_WAIT_STABLE";
  }
  return "MIX_IDLE";
}

// Bao len web: dang o che do nao, va hai may trang thai dang o buoc nao.
//
// Che do doi duoc o BA noi — dashboard, man Nextion, va nut co trong tu dien.
// Chi cai dau di qua backend, nen truoc day web co the hien THU CONG trong khi
// ngoai ruong da chay TU DONG ca tieng. Gio moi lan doi deu bao ve day.
void reportStatusToWeb() {
  if (WiFi.status() != WL_CONNECTED) return;

  StaticJsonDocument<256> doc;
  doc["mode"] = (systemMode == 1) ? "AUTO" : (systemMode == 0 ? "MANUAL" : "NONE");
  doc["autoState"] = autoStateName(autoState);
  doc["mixState"] = mixStateName(mixState);
  doc["mixReady"] = isMixingReady;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  beginRequest(http, "/api/status/report");
  http.addHeader("Content-Type", "application/json");
  http.POST(body);
  http.end();
}

void pushDeviceStateToWeb() {
  if (WiFi.status() != WL_CONNECTED) return;
  bool pumps[5];
  bool valves[4];
  xSemaphoreTake(systemMutex, portMAX_DELAY);
  for (int i = 0; i < 5; i++) pumps[i] = pumpState[i];
  for (int i = 0; i < 4; i++) valves[i] = valveState[i];
  xSemaphoreGive(systemMutex);

  DynamicJsonDocument doc(1024);
  for (int i = 0; i < 5; i++) doc["pump" + String(i + 1)] = pumps[i] ? "ON" : "OFF";
  for (int i = 0; i < 4; i++) doc["van" + String(i + 1)] = valves[i] ? "ON" : "OFF";
  
  String body;
  serializeJson(doc, body);
  HTTPClient http;
  if (!beginRequest(http, "/api/devices/state")) return;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  Serial.printf(">> [WEB] Device State -> %d\n", code);
  http.end();
}

// =======================================================
// POLL WEB COMMANDS
// =======================================================
void pollWebCommands() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (webCommandId != -1) return;

  HTTPClient http;
  if (!beginRequest(http, "/api/commands/pending?limit=1")) return;
  int code = http.GET();
  if (code != 200) { http.end(); return; }
  String response = http.getString();
  http.end();

  DynamicJsonDocument doc(4096);
  DeserializationError error = deserializeJson(doc, response);
  if (error) return;

  JsonArray commands = doc.as<JsonArray>();
  for (JsonObject cmd : commands) {
    int id = cmd["id"] | -1;
    String devId = cmd["device_id"].as<String>();
    String action = cmd["action"].as<String>();

    if (id < 0) continue;
    Serial.printf(">> [WEB] ID=%d DEV=%s ACTION=%s\n", id, devId.c_str(), action.c_str());

    if (devId == "mode") {
      bool autoMode = (action == "AUTO");
      systemMode = autoMode ? 1 : 0;
      enqueueCommand(autoMode ? "<SET_MODE=AUTO>" : "<SET_MODE=MANUAL>");
      bom1State = false; van1State = false;
      webCommandId = id;
      updateDashboard();
      updateNextionControlStates();
      return;
    }

    if (action == "ESTOP" || devId == "estop") {
      enqueueEmergencyStop();
      webCommandId = id;
      return;
    }

    bool isON = (action == "ON");
    int relayPin = -1;

    // Chi tinh ra so relay. Trang thai KHONG ghi o day — cho Nano ACK roi
    // applyAckedRelayState() moi ghi, giong het duong Nextion. Neu Nano NACK
    // (vi dang o AUTO chang han) thi dashboard giu nguyen trang thai that thay
    // vi ve mot cai bom dang chay khong co that.
    if (devId.startsWith("pump")) {
      int n = devId.substring(4).toInt();
      if (n >= 1 && n <= 5) relayPin = n;
    } else if (devId.startsWith("van")) {
      int valveNum = devId.substring(3).toInt();
      if (valveNum >= 1 && valveNum <= 4) relayPin = valveNum + 5;
    }

    if (relayPin >= 1 && relayPin <= 9) {
      String loraCmd = isON ? "<ON" + String(relayPin) + ">" : "<OFF" + String(relayPin) + ">";
      if (enqueueCommand(loraCmd)) {
        webCommandId = id;
        deviceStatePending = true;
        updateDashboard();
        updateNextionControlStates();
      }
      return;
    }
  }
}

// =======================================================
// WEB TASK CORE 0
// =======================================================
void webTask(void* parameter) {
  Serial.println(">> [WEB TASK] CORE 0");
  unsigned long lastWiFiRetry = 0; 
  for (;;) {
    unsigned long now = millis();
    bool currentWiFiState = (WiFi.status() == WL_CONNECTED);
    if (currentWiFiState != lastWiFiState) {
      lastWiFiState = currentWiFiState;
      xSemaphoreTake(systemMutex, portMAX_DELAY);
      wifiUIUpdatePending = true; 
      xSemaphoreGive(systemMutex);
    }

    if (!currentWiFiState) {
      if (now - lastWiFiRetry >= 10000UL) { 
        lastWiFiRetry = now;
        Serial.println(">> [WIFI] Mat ket noi. Dang thu lai...");
        WiFi.disconnect();
        WiFi.begin(ssid, password);
      }
    }

    bool sendAck = false;
    int ackId = -1;
    bool ackSuccess = false;

    xSemaphoreTake(systemMutex, portMAX_DELAY);
    if (webAckPending) {
      sendAck = true;
      ackId = webAckId;
      ackSuccess = webAckSuccess;
      webAckPending = false;
      webAckId = -1;
    }
    xSemaphoreGive(systemMutex);

    if (sendAck) {
      ackWebCommand(ackId, ackSuccess);
    }

    if (now - lastWebPoll >= WEB_POLL_INTERVAL) {
      lastWebPoll = now;
      pollWebCommands();
    }

    if ((telemetryPending || now - lastTelemetryPost >= TELEMETRY_INTERVAL) && WiFi.status() == WL_CONNECTED) {
      lastTelemetryPost = now;
      telemetryPending = false;
      postTelemetryToWeb();
    }

    if (settingsPending && WiFi.status() == WL_CONNECTED) {
      settingsPending = false;
      pushSettingsToWeb();
    }

    if (statusReportPending && WiFi.status() == WL_CONNECTED) {
      statusReportPending = false;
      reportStatusToWeb();
    }

    if (deviceStatePending && WiFi.status() == WL_CONNECTED) {
      deviceStatePending = false;
      pushDeviceStateToWeb();
    }

    if (now - lastStatePush >= STATE_PUSH_INTERVAL) {
      lastStatePush = now;
      pushDeviceStateToWeb();
    }

    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// =======================================================
// LORA DATA HANDLING
// =======================================================
void processLoRaData(const String& incomingData) {
  if (!incomingData.startsWith("<DATA:") || !incomingData.endsWith(">")) return;
  String raw = incomingData.substring(6, incomingData.length() - 1);

  xSemaphoreTake(systemMutex, portMAX_DELAY);
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
  RainPercent = getValue(raw, ',', 11).toInt();
  AirTemp = getValue(raw, ',', 12).toFloat();
  AirHum = getValue(raw, ',', 13).toFloat();
  lastLoraRxTime = millis();
  xSemaphoreGive(systemMutex);

  updateDashboard();
  telemetryPending = true;
}

// Xử lý gói <SYNC:...> Nano chủ động báo lên (nút cơ / công tắc AUTO-MANUAL
// tại tủ điện). Sau khi cập nhật state xong, phản hồi lại <SYNC_ACK> để
// Nano biết gói đã tới nơi (Nano sẽ retry nếu không thấy ACK này).
void processLoRaSync(const String& incomingData) {
  if (!incomingData.startsWith("<SYNC:") || !incomingData.endsWith(">")) return;
  String content = incomingData.substring(6, incomingData.length() - 1);
  int equalIdx = content.indexOf('=');
  if (equalIdx < 0) return;
  
  String devName = content.substring(0, equalIdx);
  int stateVal = content.substring(equalIdx + 1).toInt();

  if (devName == "MODE") {
    xSemaphoreTake(systemMutex, portMAX_DELAY);
    systemMode = stateVal;
    if (systemMode == 0) { bom1State = false; van1State = false; }
    xSemaphoreGive(systemMutex);
    updateNextionControlStates();
    updateDashboard();
    deviceStatePending = true;
    loraSerial.println("<SYNC_ACK>");
    statusReportPending = true;   // bao web: che do vua doi tu nut co duoi tu
    return;
  }

  bool isOn = (stateVal == 1);
  bool matched = false;
  if (devName.startsWith("BOM")) {
    int num = devName.substring(3).toInt();
    if (num >= 1 && num <= 5) {
      xSemaphoreTake(systemMutex, portMAX_DELAY);
      pumpState[num - 1] = isOn;
      if (num == 1) bom1State = isOn;
      xSemaphoreGive(systemMutex);
      updateNextionControlStates();
      matched = true;
    }
  } else if (devName.startsWith("VAN")) {
    int num = devName.substring(3).toInt();
    if (num >= 1 && num <= 4) {
      xSemaphoreTake(systemMutex, portMAX_DELAY);
      valveState[num - 1] = isOn;
      if (num == 1) van1State = isOn;
      xSemaphoreGive(systemMutex);
      updateNextionControlStates();
      matched = true;
    }
  }
  if (matched) {
    updateDashboard();
    deviceStatePending = true;
    loraSerial.println("<SYNC_ACK>");
  }
}

// Ghi nhan trang thai relay SAU KHI Nano da xac nhan bang ACK.
//
// Truoc day trang thai duoc ghi ngay luc bam nut ("lac quan"), va rieng lenh do
// may trang thai AUTO sinh ra (enqueueAutoCommand) thi KHONG ghi o dau ca. Hai
// hau qua:
//   - AUTO chay bom ca buoi ma dashboard van bao OFF het, vi pumpState[] khong
//     ai dong vao. Telemetry di duong khac nen so do van dung -> nhin ra ngoai
//     giong het "do dung ma control sai".
//   - Nano NACK (tu choi) thi trang thai da ghi lac quan van nam lai, dashboard
//     va man Nextion hien mot cai bom dang chay ma thuc te khong chay.
//
// Gio chi mot noi duy nhat duoc ghi, va chi ghi khi da chac chan.
void applyAckedRelayState(const String& cmd) {
  int relay = -1;
  bool on = false;
  if (cmd.startsWith("<AUTOON"))       { relay = cmd.substring(7, cmd.length() - 1).toInt(); on = true;  }
  else if (cmd.startsWith("<AUTOOFF")) { relay = cmd.substring(8, cmd.length() - 1).toInt(); on = false; }
  else if (cmd.startsWith("<ON"))      { relay = cmd.substring(3, cmd.length() - 1).toInt(); on = true;  }
  else if (cmd.startsWith("<OFF"))     { relay = cmd.substring(4, cmd.length() - 1).toInt(); on = false; }
  else return;

  if (relay < 1 || relay > 9) return;

  xSemaphoreTake(systemMutex, portMAX_DELAY);
  if (relay <= 5) {
    pumpState[relay - 1] = on;
    if (relay == 1) bom1State = on;
  } else {
    valveState[relay - 6] = on;
    if (relay == 6) van1State = on;
  }
  xSemaphoreGive(systemMutex);

  deviceStatePending = true;   // day len web o vong ke tiep
}

void handleLoraIncoming() {
  while (loraSerial.available()) {
    String incoming = loraSerial.readStringUntil('\n');
    incoming.trim();
    if (incoming.length() == 0) continue;
    Serial.println("  [LORA RX] " + incoming);

    processLoRaData(incoming);
    processLoRaSync(incoming);

    // ===================================================
    // ACK / NACK
    // ===================================================
    if (isWaitingAck) {
      // Tự động bóc tách đúng phần thân lệnh (ví dụ: <ON1> -> ACK_ON1, <OFF5> -> ACK_OFF5,
      // <AUTOON5> -> ACK_AUTOON5)
      String cmdBody = currentCommand.substring(1, currentCommand.length() - 1); // Lấy chữ bên trong dấu <>
      String expectedAck = "<ACK_" + cmdBody + ">";
      String expectedNack = "<NACK_" + cmdBody + ">";

      if (incoming.indexOf(expectedAck) >= 0) {
        Serial.println("  [LORA] ACK OK: " + expectedAck);
        // Chi tai day trang thai relay moi duoc coi la that. Bao gom ca lenh
        // <AUTOONx>/<AUTOOFFx> do state machine AUTO tu sinh ra, truoc day
        // khong duoc ghi nhan o bat cu dau.
        applyAckedRelayState(currentCommand);
        updateNextionControlStates();
        isWaitingAck = false;
        retryCount = 0;
        
        if (webCommandId >= 0) {
          setWebAckResult(webCommandId, true);
        }
        currentCommand = "";
        updateOLED("TRANG THAI: OK", "ACK");
      }
      else if (incoming.indexOf(expectedNack) >= 0) {
        Serial.println("  [LORA] NACK - Nano tu choi lenh (co the desync mode): " + currentCommand);
        isWaitingAck = false;
        retryCount = 0;
        if (webCommandId >= 0) {
          setWebAckResult(webCommandId, false);
        }
        currentCommand = "";
        updateOLED("CANH BAO", "NANO TU CHOI LENH");
        // Lenh KHONG he duoc thuc thi -> trang thai giu nguyen, va keo nut tren
        // Nextion ve dung thuc te (nguoi dung vua bam nen no da tu doi mau).
        updateNextionControlStates();
        deviceStatePending = true;
        // Nano từ chối nghĩa là 2 board đang hiểu khác nhau về mode (hoặc lệnh tay
        // lọt vào khi đang AUTO) -> dừng an toàn state machine AUTO thay vì chạy tiếp
        // dựa trên giả định sai.
        autoState = AUTO_IDLE;
        mixState = MIX_IDLE;
      }
    }
  }
}

// =======================================================
// NEXTION SETTINGS PAGE UPDATE
// =======================================================
void updateNextionSettingsPage() {
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
}

// =======================================================
// NEXTION COMMANDS
// =======================================================
void processNextionCommand(const String& cmd) {
  if (cmd.length() == 0) return;
  String cmdUpper = cmd;
  cmdUpper.toUpperCase();

  if (cmdUpper.startsWith("CHECK_PASS=")) {
    String entered = cmd.substring(11);
    entered.trim(); systemPassword.trim();
    if (entered == systemPassword) {
      sendNextionCmd("page page1");
    } else {
      sendNextionCmd("va0.val=1"); sendNextionCmd("t0.pw=0");
      sendNextionCmd("t0.pco=63488"); sendNextionCmd("t0.txt=\"X\"");
    }
    return;
  }

  if (cmdUpper.startsWith("CHGPASS=")) {
    String data = cmd.substring(8);
    int firstComma = data.indexOf(',');
    int secondComma = data.lastIndexOf(',');
    if (firstComma >= 0 && secondComma > firstComma) {
      String oldPass = data.substring(0, firstComma);
      String newPass1 = data.substring(firstComma + 1, secondComma);
      String newPass2 = data.substring(secondComma + 1);
      oldPass.trim(); newPass1.trim(); newPass2.trim();
      if (oldPass != systemPassword) {
        sendNextionCmd("t0.pw=0"); sendNextionCmd("t0.pco=63488"); sendNextionCmd("t0.txt=\"X\"");
      } else if (newPass1 != newPass2) {
        sendNextionCmd("t2.pw=0"); sendNextionCmd("t2.pco=63488"); sendNextionCmd("t2.txt=\"X\"");
      } else {
        systemPassword = newPass1;
        preferences.begin("system_data", false);
        preferences.putString("password", systemPassword);
        preferences.end();
        sendNextionCmd("page page0");
      }
    }
    return;
  }

  if (cmdUpper == "CMD=MODE_AUTO") {
    systemMode = 1;
    enqueueCommand("<SET_MODE=AUTO>");
    updateDashboard();
    updateNextionControlStates();
    statusReportPending = true;   // bao web: che do vua doi tu man HMI
    return;
  }

  if (cmdUpper == "CMD=MODE_MANUAL") {
    systemMode = 0;
    enqueueCommand("<SET_MODE=MANUAL>");
    bom1State = false; van1State = false;
    updateDashboard();
    updateNextionControlStates();
    statusReportPending = true;   // bao web: che do vua doi tu man HMI
    return;
  }

 if (cmdUpper.startsWith("BOM")) {
    int equalPos = cmd.indexOf('=');
    int num = cmd.substring(3, equalPos).toInt();
    int state = cmd.substring(equalPos + 1).toInt();
    bool isOn = (state == 1); // Đảm bảo trạng thái ON/OFF khớp với giá trị .val của bạn (1 là ON, 0 là OFF)

    // Moi nhanh phai ket thuc bang mot viec THAY DUOC. Truoc day chi co dieu
    // kien (systemMode == 0 && !isWaitingAck) va khong he co else, nen ba tinh
    // huong rat hay gap deu im lang tuyet doi: chua chon che do (systemMode
    // == -1), dang o AUTO, va dang cho ACK lenh truoc. Nguoi van hanh bam nut,
    // relay khong keu, man khong bao gi — ma nut thi DA tu doi mau luc cham vao.
    if (num < 1 || num > 5) return;

    if (systemMode == -1) {
      Serial.println(">> [CHUA CHON CHE DO] Bam THU CONG truoc da.");
      updateOLED("CHUA CHON CHE DO", "Bam THU CONG truoc");
      updateNextionControlStates();
    } else if (systemMode == 1) {
      Serial.println(">> [DANG O AUTO] Tu choi lenh tay tu Nextion.");
      updateOLED("DANG O TU DONG", "Tu choi lenh tay");
      updateNextionControlStates();
    } else if (isWaitingAck) {
      Serial.println(">> [BAN] Dang cho ACK lenh truoc, bo qua lan bam nay.");
      updateOLED("DANG BAN", "Cho ACK lenh truoc");
      updateNextionControlStates();
    } else {
      // Khong ghi pumpState o day nua — cho ACK cua Nano roi moi ghi, de mot lan
      // bi NACK khong de lai trang thai gia tren dashboard.
      String loraMsg = isOn ? "<ON" + String(num) + ">" : "<OFF" + String(num) + ">";
      enqueueCommand(loraMsg);
    }
    return;
  }
  if (cmdUpper.startsWith("VAN")) {
    int equalPos = cmd.indexOf('=');
    if (equalPos < 0) return;
    int num = cmd.substring(3, equalPos).toInt();
    int state = cmd.substring(equalPos + 1).toInt();
    bool isOn = (state == 1); // Trạng thái ON/OFF khớp với Dual-state Button (.val)

    // Bon nhanh y het khoi BOM o tren, xem giai thich o do.
    if (num < 1 || num > 4) return;

    if (systemMode == -1) {
      Serial.println(">> [CHUA CHON CHE DO] Bam THU CONG truoc da.");
      updateOLED("CHUA CHON CHE DO", "Bam THU CONG truoc");
      updateNextionControlStates();
    } else if (systemMode == 1) {
      Serial.println(">> [DANG O AUTO] Tu choi lenh tay tu Nextion.");
      updateOLED("DANG O TU DONG", "Tu choi lenh tay");
      updateNextionControlStates();
    } else if (isWaitingAck) {
      Serial.println(">> [BAN] Dang cho ACK lenh truoc, bo qua lan bam nay.");
      updateOLED("DANG BAN", "Cho ACK lenh truoc");
      updateNextionControlStates();
    } else {
      int relay = num + 5; // Van 1 -> Relay 6, Van 2 -> Relay 7,...
      String loraMsg = isOn ? "<ON" + String(relay) + ">" : "<OFF" + String(relay) + ">";
      enqueueCommand(loraMsg);
    }
    return;
  }

  if (cmdUpper == "DASHBOARD_READY=") { updateWiFiIcon(); updateDashboard(); return; }
  if (cmdUpper == "MENU_READY=") { updateWiFiIcon(); return; }
  if (cmdUpper == "SETTINGS_READY=") { updateWiFiIcon(); updateNextionSettingsPage(); return; }
  if (cmdUpper == "ABOUT_READY=") { updateWiFiIcon(); return; }
  if (cmdUpper == "CONTROL_READY=") { updateWiFiIcon(); updateNextionControlStates(); return; }
  
  if (cmdUpper == "CMD=ESTOP" || cmdUpper.startsWith("DUNGKHANCAP")) {
    enqueueEmergencyStop();
    return;
  }

  if (cmdUpper.startsWith("SAVE=")) {
    String data = cmd.substring(5);
    float newPhMin = getValue(data, ',', 0).toFloat();
    float newPhMax = getValue(data, ',', 1).toFloat();
    // Quy ve uS/cm ngay tai cua vao, de Flash chi chua mot don vi duy nhat du
    // nguoi van hanh go "1.5" (quen tay mS/cm) hay "1500".
    float newEcMin = ecToMicro(getValue(data, ',', 2).toFloat());
    float newEcMax = ecToMicro(getValue(data, ',', 3).toFloat());
    float newTempMin = getValue(data, ',', 4).toFloat();
    float newTempMax = getValue(data, ',', 5).toFloat();
    float newHumMin = getValue(data, ',', 6).toFloat();
    float newHumMax = getValue(data, ',', 7).toFloat();
    int newTimeBom = getValue(data, ',', 8).toInt();
    int newTimeNghi = getValue(data, ',', 9).toInt();

    if (newPhMin >= newPhMax || newEcMin >= newEcMax || newTempMin >= newTempMax || newHumMin >= newHumMax || newTimeBom <= 0 || newTimeNghi < 0) {
      Serial.println(">> [SETTINGS] Giá trị không hợp lệ!");
      updateNextionSettingsPage();
      return;
    }

    phMin = newPhMin; phMax = newPhMax; ecMin = newEcMin; ecMax = newEcMax;
    tempMin = newTempMin; tempMax = newTempMax; humMin = newHumMin; humMax = newHumMax;
    timeBom = newTimeBom; timeNghi = newTimeNghi;

    preferences.begin("system_data", false);
    preferences.putFloat("phMin", phMin); preferences.putFloat("phMax", phMax);
    preferences.putFloat("ecMin", ecMin); preferences.putFloat("ecMax", ecMax);
    preferences.putFloat("tempMin", tempMin); preferences.putFloat("tempMax", tempMax);
    preferences.putFloat("humMin", humMin); preferences.putFloat("humMax", humMax);
    preferences.putInt("timeBom", timeBom); preferences.putInt("timeNghi", timeNghi);
    preferences.end();

    // Lưu ý: KHÔNG gửi ngưỡng xuống Nano qua LoRa nữa. Ngưỡng chỉ dùng để
    // ESP32 so sánh với dữ liệu cảm biến nội bộ - Nano không cần biết và
    // không xử lý gói này (trước đây gửi thừa, chiếm 1 slot Queue+ACK vô ích).
    settingsPending = true;
    updateNextionSettingsPage();
    Serial.println(">> [SETTINGS] Saved");
    return;
  }

  if (cmdUpper == "CMD=REBOOT") {
    updateOLED("SYSTEM", "Rebooting...");
    sendNextionCmd("page page0");
    delay(1000);
    ESP.restart();
    return;
  }

  if (cmdUpper == "CMD=RESTORE") {
    phMin = 5.5; phMax = 6.5; ecMin = EC_MIN_DEFAULT; ecMax = EC_MAX_DEFAULT;
    tempMin = 22.0; tempMax = 35.0; humMin = 65.0; humMax = 80.0;
    timeBom = 10; timeNghi = 15;

    preferences.begin("system_data", false);
    preferences.putFloat("phMin", phMin); preferences.putFloat("phMax", phMax);
    preferences.putFloat("ecMin", ecMin); preferences.putFloat("ecMax", ecMax);
    preferences.putFloat("tempMin", tempMin); preferences.putFloat("tempMax", tempMax);
    preferences.putFloat("humMin", humMin); preferences.putFloat("humMax", humMax);
    preferences.putInt("timeBom", timeBom); preferences.putInt("timeNghi", timeNghi);
    preferences.end();

    updateNextionSettingsPage();
    // Không gửi <SET_DATA=...> xuống Nano (lý do như trên).
    settingsPending = true;
    return;
  }
}

void handleNextionIncoming() {
  while (nextion.available()) {
    String cmd = nextion.readStringUntil('\n');
    cmd.trim();
    if (cmd.length() == 0) continue;
    processNextionCommand(cmd);
  }
}

// =======================================================
// SETUP
// =======================================================
void setup() {
  Serial.begin(115200);
  Serial.println("\n========================================");
  Serial.println(" ESP32-S3 MASTER STATION");
  Serial.println(" QUEUE + ACK + FREERTOS");
  Serial.println("========================================");

  systemMutex = xSemaphoreCreateMutex();
  queueMutex = xSemaphoreCreateMutex();
  if (systemMutex == NULL || queueMutex == NULL) {
    Serial.println(">> FATAL: MUTEX CREATE FAILED");
    while (true) delay(1000);
  }

  Wire.begin(I2C_SDA, I2C_SCL);
  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println("[OLED] INIT FAILED");
  } else {
    display.setRotation(2);
    updateOLED("MASTER BOOT", "Khoi tao...");
  }

  pinMode(LORA_M0, OUTPUT); pinMode(LORA_M1, OUTPUT); pinMode(LORA_AUX, INPUT);
  digitalWrite(LORA_M0, LOW); digitalWrite(LORA_M1, LOW);

  unsigned long auxStart = millis();
  while (digitalRead(LORA_AUX) == LOW) {
    if (millis() - auxStart > 3000UL) { Serial.println(">> [LORA] AUX TIMEOUT"); break; }
    delay(10);
  }

  loraSerial.setRxBufferSize(512);
  loraSerial.begin(9600, SERIAL_8N1, LORA_RX_PIN, LORA_TX_PIN);
  loraSerial.setTimeout(50);
  while (loraSerial.available()) loraSerial.read();

  nextion.begin(115200, SERIAL_8N1, NEXTION_RX, NEXTION_TX);
  nextion.setTimeout(20);
  delay(500);
  while (nextion.available()) nextion.read();

  preferences.begin("system_data", false);
  systemPassword = preferences.getString("password", "123456");
  phMin = preferences.getFloat("phMin", 5.5); phMax = preferences.getFloat("phMax", 6.5);
  ecMin = ecToMicro(preferences.getFloat("ecMin", EC_MIN_DEFAULT));
  ecMax = ecToMicro(preferences.getFloat("ecMax", EC_MAX_DEFAULT));
  tempMin = preferences.getFloat("tempMin", 22.0); tempMax = preferences.getFloat("tempMax", 35.0);
  humMin = preferences.getFloat("humMin", 65.0); humMax = preferences.getFloat("humMax", 80.0);
  timeBom = preferences.getInt("timeBom", 10); timeNghi = preferences.getInt("timeNghi", 15);
  preferences.end();

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  updateOLED("WIFI", "Connecting...");
  int wifiAttempts = 0;
  while (WiFi.status() != WL_CONNECTED && wifiAttempts < 20) { delay(500); Serial.print("."); wifiAttempts++; }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected");
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    updateOLED("MASTER READY", "WiFi Connected");
  } else {
    Serial.println("\n[WIFI] Offline");
    updateOLED("MASTER READY", "WiFi Offline");
  }

  sendNextionCmd("page page0");

  BaseType_t taskResult = xTaskCreatePinnedToCore(webTask, "WebTask", 12288, NULL, 1, &webTaskHandle, 0);
  if (taskResult == pdPASS) Serial.println(">> [SYSTEM] WebTask CORE 0 OK");
  else Serial.println(">> [SYSTEM] WebTask FAILED");
}

// =======================================================
// LOOP CORE 1
// =======================================================
void loop() {
  handleLoraIncoming();
  processLoRaQueue();
  pollStm32IfIdle();
  // Bat moi lan hai may trang thai buoc sang trang thai khac, de man CONTROL
  // tren web ve duoc dai tien trinh dang chay den dau. Chi bao khi CO doi, khong
  // ban lien tuc moi vong quet.
  static AutoState lastAutoState = AUTO_IDLE;
  static MixState  lastMixState  = MIX_IDLE;
  static bool      lastMixReady  = false;

  handleAutoMixingLogic();
  handleAutoIrrigationLogic();

  if (autoState != lastAutoState || mixState != lastMixState || isMixingReady != lastMixReady) {
    lastAutoState = autoState;
    lastMixState  = mixState;
    lastMixReady  = isMixingReady;
    statusReportPending = true;
  }

  handleNextionIncoming();

  if (millis() - lastUpdate >= 1000UL) {
    lastUpdate = millis();
    updateClock();
  }

  bool needWiFiUpdate = false;
  xSemaphoreTake(systemMutex, portMAX_DELAY);
  if (wifiUIUpdatePending) {
    needWiFiUpdate = true;
    wifiUIUpdatePending = false;
  }
  xSemaphoreGive(systemMutex);

  if (needWiFiUpdate) {
    updateWiFiIcon();
    if (WiFi.status() == WL_CONNECTED) updateOLED("MASTER READY", "WiFi Connected");
    else updateOLED("MASTER READY", "WiFi Offline");
  }

  delay(1);
}






