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
HardwareSerial loraSerial(1); 
HardwareSerial nextion(2);

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C
#define I2C_SDA 9
#define I2C_SCL 10
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

#define LORA_M0 5
#define LORA_M1 6
#define LORA_AUX 8
#define LORA_RX_PIN 18
#define LORA_TX_PIN 17

#define NEXTION_RX 12
#define NEXTION_TX 11

const char* ssid = "DESKTOP-2GO7JB8 5238";
const char* password = "78U5%g77kkkkk";
const char* ntpServer = "time.google.com";
const long gmtOffset_sec = 7 * 3600; 
const int daylightOffset_sec = 0;
const char* BACKEND_BASE = "http://192.168.137.206:4000";
const char* DEVICE_API_KEY = "changeme-esp32-secret";
const uint16_t HTTP_CONNECT_TIMEOUT_MS = 1500; 
const uint16_t HTTP_TIMEOUT_MS = 2500;

TaskHandle_t webTaskHandle = NULL;
SemaphoreHandle_t systemMutex = NULL; 
SemaphoreHandle_t queueMutex = NULL;

volatile bool telemetryPending = false, settingsPending = false, deviceStatePending = false, wifiUIUpdatePending = false;
bool lastWiFiState = false; 
int webCommandId = -1, webAckId = -1;
volatile bool webAckPending = false; 
bool webAckSuccess = false;

unsigned long lastWebPoll = 0, lastTelemetryPost = 0, lastStatePush = 0;
const unsigned long WEB_POLL_INTERVAL = 3000UL, TELEMETRY_INTERVAL = 3000UL, STATE_PUSH_INTERVAL = 5000UL;

String systemPassword; 
unsigned long lastUpdate = 0; 
int systemMode = -1;  
bool pumpState[5] = {false, false, false, false, false}; 
bool valveState[4] = {false, false, false, false};

unsigned long lastLoraRxTime = 0, lastSensorPollTime = 0;
const unsigned long SENSOR_POLL_INTERVAL = 2000UL, LORA_ONLINE_TIMEOUT = 180000UL;
const unsigned long AUTO_POLL_INTERVAL = 300000UL; 

// Đổi EC_Value sang float cùng dòng với các thông số khác
float Temperature = 0.0, Humidity = 0.0, pH_Value = 0.0, EC_Value = 0.0;
uint16_t Nitrogen = 0, Phosphorus = 0, Potassium = 0;
float Dist1 = 0.0, Dist2 = 0.0, Dist3 = 0.0, Dist4 = 0.0;
int RainPercent = 0; 
float AirTemp = 0.0, AirHum = 0.0;
float phMin, phMax, ecMin, ecMax, tempMin, tempMax, humMin, humMax; 
int timeBom, timeNghi;
const float WATER_EMPTY_DIST = 80.0; 
const int RAIN_MAX_PERCENT = 50;

const int QUEUE_SIZE = 15; 
String cmdQueue[QUEUE_SIZE]; 
int queueHead = 0, queueTail = 0;

unsigned long lastSendTime = 0;
const unsigned long TIMEOUT_MS = 800UL;      
const unsigned long INTER_CMD_DELAY = 100UL;  
const int MAX_RETRIES = 2;                   
int retryCount = 0; 
String currentCommand = ""; 
bool isWaitingAck = false;

const char* EMERGENCY_COMMAND = "<B:ESTOP>";

enum AutoState { AUTO_IDLE, AUTO_OPEN_VALVE, AUTO_WAIT_VALVE_ON, AUTO_WAIT_PUMP_ON, AUTO_IRRIGATING, AUTO_WAIT_PUMP_OFF, AUTO_WAIT_VALVE_OFF, AUTO_RESTING };
AutoState autoState = AUTO_IDLE; 
unsigned long autoStateTimer = 0;

enum MixState { MIX_IDLE, MIX_WAIT_PUMP3_ON, MIX_PUMPING_WATER, MIX_WAIT_PUMP3_OFF, MIX_WAIT_NUTRIENT_PUMPS_ON, MIX_DOSING_NUTRIENT, MIX_WAIT_NUTRIENT_PUMPS_OFF, MIX_WAIT_STIR_PUMP_ON, MIX_STIRRING, MIX_WAIT_STIR_PUMP_OFF, MIX_WAIT_STABLE };
MixState mixState = MIX_IDLE; 
unsigned long mixStateTimer = 0; 
bool isMixingReady = false;

String getValue(const String& data, char separator, int index) {
  int found = 0; int strIndex[] = {0, -1}; int maxIndex = data.length() - 1;
  for (int i = 0; i <= maxIndex && found <= index; i++) {
    if (data.charAt(i) == separator || i == maxIndex) { found++; strIndex[0] = strIndex[1] + 1; strIndex[1] = (i == maxIndex) ? i + 1 : i; }
  } 
  return (found > index) ? data.substring(strIndex[0], strIndex[1]) : "";
}

void sendNextionCmd(const String& cmd) { nextion.print(cmd); nextion.write(0xFF); nextion.write(0xFF); nextion.write(0xFF); }
void sendText(const String& obj, const String& txt) { sendNextionCmd(obj + "=\"" + txt + "\""); }
void sendValue(const String& obj, int val) { sendNextionCmd(obj + "=" + String(val)); }

void updateOLED(const String& line1, const String& line2) {
  display.clearDisplay(); display.setTextSize(1); display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0); display.println(line1); 
  display.setCursor(0, 16); display.println(line2); 
  display.display();
}

void updateWiFiIcon() { sendNextionCmd("vis pwifi," + String(WiFi.status() == WL_CONNECTED ? 0 : 1)); }

void updateDashboard() {
  sendText("t0.txt", String(Temperature, 1)); sendText("t1.txt", String(Humidity, 1));
  sendText("t2.txt", String(pH_Value, 1)); sendText("t3.txt", String(EC_Value, 2)); // Gửi EC dạng số thập phân
  sendText("t4.txt", String(Potassium)); sendText("t5.txt", String(Nitrogen));
  sendText("t6.txt", String(Dist1, 1)); sendText("t7.txt", String(Dist2, 1));
  sendText("t8.txt", String(Dist3, 1)); sendText("t9.txt", String(Dist4, 1));
  String rainStatus = (RainPercent < 10) ? "Khong mua" : (RainPercent < 40) ? "Mua nho" : (RainPercent < 70) ? "Mua vua" : "Mua to";
  sendText("t12.txt", rainStatus); sendText("t11.txt", String(AirTemp, 1)); sendText("t10.txt", String(AirHum, 1));
}

void updateNextionControlStates() {
  if (systemMode == 1) { sendValue("page3.bt10.val", 1); sendValue("page3.bt9.val", 0); } 
  else if (systemMode == 0) { sendValue("page3.bt10.val", 0); sendValue("page3.bt9.val", 1); } 
  else { sendValue("page3.bt10.val", 0); sendValue("page3.bt9.val", 0); }
  xSemaphoreTake(systemMutex, portMAX_DELAY);
  for (int i = 0; i < 5; i++) sendValue("page3.bt" + String(i) + ".val", pumpState[i] ? 1 : 0);
  for (int i = 0; i < 4; i++) sendValue("page3.bt" + String(i + 5) + ".val", valveState[i] ? 1 : 0);
  xSemaphoreGive(systemMutex);
}

void updateClock() {
  struct tm t; if (!getLocalTime(&t)) return; char str[20];
  snprintf(str, sizeof(str), "%02d:%02d:%02d", t.tm_hour, t.tm_min, t.tm_sec); sendText("time.txt", str);
  snprintf(str, sizeof(str), "%02d/%02d/%04d", t.tm_mday, t.tm_mon + 1, t.tm_year + 1900); sendText("date.txt", str);
}

void clearCommandQueue() {
  if (queueMutex != NULL) xSemaphoreTake(queueMutex, portMAX_DELAY);
  queueHead = 0; queueTail = 0; for (int i = 0; i < QUEUE_SIZE; i++) cmdQueue[i] = "";
  if (queueMutex != NULL) xSemaphoreGive(queueMutex);
}

bool isCommandInQueue(const String& cmd) {
  bool found = false;
  xSemaphoreTake(queueMutex, portMAX_DELAY);
  int i = queueHead;
  while (i != queueTail) {
    if (cmdQueue[i] == cmd) { found = true; break; }
    i = (i + 1) % QUEUE_SIZE;
  }
  xSemaphoreGive(queueMutex);
  return found;
}

bool enqueueCommand(const String& cmd) {
  if (cmd.length() == 0) return false; bool success = false;
  xSemaphoreTake(queueMutex, portMAX_DELAY);
  int lastItemIndex = (queueTail - 1 + QUEUE_SIZE) % QUEUE_SIZE;
  if (queueHead != queueTail && cmdQueue[lastItemIndex] == cmd) { xSemaphoreGive(queueMutex); return false; }
  int nextTail = (queueTail + 1) % QUEUE_SIZE;
  if (nextTail != queueHead) { cmdQueue[queueTail] = cmd; queueTail = nextTail; success = true; }
  xSemaphoreGive(queueMutex); return success;
}

void safelySwitchMode(int newMode) {
  clearCommandQueue(); 
  xSemaphoreTake(systemMutex, portMAX_DELAY); systemMode = newMode;
  if (newMode == 0) { for (int i = 0; i < 5; i++) pumpState[i] = false; for (int i = 0; i < 4; i++) valveState[i] = false; }
  xSemaphoreGive(systemMutex);
  autoState = AUTO_IDLE; mixState = MIX_IDLE; isMixingReady = false;

  if (newMode == 0) { 
    updateOLED("CHUYEN CHE DO", "-> MANUAL"); updateNextionControlStates(); loraSerial.println(EMERGENCY_COMMAND); delay(50); 
  } 
  else { 
    updateOLED("CHE DO AUTO", "Dang cho STM32..."); updateNextionControlStates(); 
    lastLoraRxTime = 0; 
    lastSensorPollTime = millis() - AUTO_POLL_INTERVAL; 
  }
  enqueueCommand(newMode == 1 ? "<B:SET_MODE=AUTO>" : "<B:SET_MODE=MANUAL>");
}

void enqueueEmergencyStop() {
  clearCommandQueue(); 
  xSemaphoreTake(systemMutex, portMAX_DELAY); systemMode = 0; 
  for (int i = 0; i < 5; i++) pumpState[i] = false; for (int i = 0; i < 4; i++) valveState[i] = false;
  xSemaphoreGive(systemMutex);
  autoState = AUTO_IDLE; mixState = MIX_IDLE; isMixingReady = false;
  loraSerial.println(EMERGENCY_COMMAND); delay(50); loraSerial.println(EMERGENCY_COMMAND);
  updateOLED("EMERGENCY STOP", "Ngat toan he thong"); updateNextionControlStates();
}

void setWebAckResult(int id, bool success) {
  if (id < 0) return; xSemaphoreTake(systemMutex, portMAX_DELAY); webAckId = id; webAckSuccess = success;
  webAckPending = true; webCommandId = -1; xSemaphoreGive(systemMutex);
}

void applyConfirmedState(String cmdBody) {
  xSemaphoreTake(systemMutex, portMAX_DELAY);
  if (cmdBody == "SET_MODE=AUTO") { systemMode = 1; } 
  else if (cmdBody == "SET_MODE=MANUAL") { systemMode = 0; } 
  else if (cmdBody.startsWith("ON")) { 
    int pin = cmdBody.substring(2).toInt(); 
    if (pin >= 1 && pin <= 5) pumpState[pin - 1] = true; 
    else if (pin >= 6 && pin <= 9) valveState[pin - 6] = true; 
  } 
  else if (cmdBody.startsWith("OFF")) { 
    int pin = cmdBody.substring(3).toInt(); 
    if (pin >= 1 && pin <= 5) pumpState[pin - 1] = false; 
    else if (pin >= 6 && pin <= 9) valveState[pin - 6] = false; 
  } 
  xSemaphoreGive(systemMutex);
  
  updateNextionControlStates(); 
  deviceStatePending = true;
}

void processLoRaQueue() {
  unsigned long now = millis();
  if (digitalRead(LORA_AUX) == LOW) return;

  if (isWaitingAck) {
    if (now - lastSendTime >= TIMEOUT_MS) {
      retryCount++;
      if (retryCount <= MAX_RETRIES) { 
        loraSerial.println(currentCommand); 
        lastSendTime = now; 
      } 
      else {
        if (webCommandId >= 0) setWebAckResult(webCommandId, false);
        isWaitingAck = false; retryCount = 0;
        
        if (currentCommand == "<A:GET_DATA>") updateOLED("LORA LOI", "STM32 Khong Data");
        else updateOLED("LORA LOI", "Khong phan hoi"); 
        
        updateNextionControlStates(); 
        currentCommand = "";
      }
    } 
    return; 
  }

  if (now - lastSendTime < INTER_CMD_DELAY) return;
  String commandToSend = "";
  xSemaphoreTake(queueMutex, portMAX_DELAY);
  if (queueHead != queueTail) { 
    commandToSend = cmdQueue[queueHead]; 
    cmdQueue[queueHead] = ""; 
    queueHead = (queueHead + 1) % QUEUE_SIZE; 
  }
  xSemaphoreGive(queueMutex);

  if (commandToSend.length() > 0) {
    currentCommand = commandToSend; 
    loraSerial.println(currentCommand); 
    lastSendTime = now; 
    isWaitingAck = true; 
    if(currentCommand != "<A:GET_DATA>") updateOLED("LORA TX:", currentCommand);
  }
}

void handleAutoMixingLogic() {
  if (systemMode != 1 || millis() - lastLoraRxTime > 5000UL) return; 
  unsigned long now = millis();
  switch (mixState) {
    case MIX_IDLE: 
      if (!isMixingReady && Dist4 > 50.0 && Dist4 > 0) { 
        enqueueCommand("<B:ON3>"); mixStateTimer = now; mixState = MIX_WAIT_PUMP3_ON; 
        updateOLED("AUTO TRON", "1. Bom nuoc vao");
      } break;
    case MIX_WAIT_PUMP3_ON: 
      if (pumpState[2]) { mixState = MIX_PUMPING_WATER; updateOLED("AUTO TRON", "2. Dang bom nuoc"); } 
      else if (now - mixStateTimer >= 4000UL) { enqueueCommand("<B:ON3>"); mixStateTimer = now; } break;
    case MIX_PUMPING_WATER: 
      if (Dist4 <= 20.0 && Dist4 > 0) { enqueueCommand("<B:OFF3>"); mixStateTimer = now; mixState = MIX_WAIT_PUMP3_OFF; } break;
    case MIX_WAIT_PUMP3_OFF: 
      if (!pumpState[2]) { mixStateTimer = now; mixState = MIX_WAIT_STABLE; updateOLED("AUTO TRON", "3. Cho on dinh"); } 
      else if (now - mixStateTimer >= 4000UL) { enqueueCommand("<B:OFF3>"); mixStateTimer = now; } break;
    case MIX_WAIT_STABLE:
      if (now - mixStateTimer >= 5000UL) {
        if (EC_Value < ecMin) { 
          enqueueCommand("<B:ON1>"); enqueueCommand("<B:ON2>"); mixStateTimer = now; mixState = MIX_WAIT_NUTRIENT_PUMPS_ON; 
          updateOLED("AUTO TRON", "4. Dang cham phan");
        } 
        else if (EC_Value > ecMax && Dist4 > 20.0) { enqueueCommand("<B:ON3>"); mixStateTimer = now; mixState = MIX_WAIT_PUMP3_ON; } 
        else { isMixingReady = true; mixState = MIX_IDLE; updateOLED("AUTO TRON", "Hoan thanh!"); }
      } break;
    case MIX_WAIT_NUTRIENT_PUMPS_ON: 
      if (pumpState[0] && pumpState[1]) { mixStateTimer = now; mixState = MIX_DOSING_NUTRIENT; } 
      else if (now - mixStateTimer >= 4000UL) { if (!pumpState[0]) enqueueCommand("<B:ON1>"); if (!pumpState[1]) enqueueCommand("<B:ON2>"); mixStateTimer = now; } break;
    case MIX_DOSING_NUTRIENT: 
      if (now - mixStateTimer >= 3000UL) { enqueueCommand("<B:OFF1>"); enqueueCommand("<B:OFF2>"); mixStateTimer = now; mixState = MIX_WAIT_NUTRIENT_PUMPS_OFF; } break;
    case MIX_WAIT_NUTRIENT_PUMPS_OFF: 
      if (!pumpState[0] && !pumpState[1]) { 
        enqueueCommand("<B:ON4>"); mixStateTimer = now; mixState = MIX_WAIT_STIR_PUMP_ON; 
        updateOLED("AUTO TRON", "5. Dang khuay...");
      } 
      else if (now - mixStateTimer >= 4000UL) { if (pumpState[0]) enqueueCommand("<B:OFF1>"); if (pumpState[1]) enqueueCommand("<B:OFF2>"); mixStateTimer = now; } break;
    case MIX_WAIT_STIR_PUMP_ON: 
      if (pumpState[3]) { mixStateTimer = now; mixState = MIX_STIRRING; } 
      else if (now - mixStateTimer >= 4000UL) { enqueueCommand("<B:ON4>"); mixStateTimer = now; } break;
    case MIX_STIRRING: 
      if (now - mixStateTimer >= 10000UL) { enqueueCommand("<B:OFF4>"); mixStateTimer = now; mixState = MIX_WAIT_STIR_PUMP_OFF; } break;
    case MIX_WAIT_STIR_PUMP_OFF: 
      if (!pumpState[3]) { mixStateTimer = now; mixState = MIX_WAIT_STABLE; updateOLED("AUTO TRON", "Do lai chi so..."); } 
      else if (now - mixStateTimer >= 4000UL) { enqueueCommand("<B:OFF4>"); mixStateTimer = now; } break;
  }
}

void handleAutoIrrigationLogic() {
  if (systemMode != 1 || millis() - lastLoraRxTime > 5000UL) return; 
  bool tankEmpty = (Dist3 > WATER_EMPTY_DIST && Dist3 > 0); 
  bool heavyRain = (RainPercent >= RAIN_MAX_PERCENT);       
  if (tankEmpty || heavyRain) {
    if (autoState != AUTO_IDLE) { 
        enqueueCommand("<B:OFF5>"); enqueueCommand("<B:OFF6>"); autoState = AUTO_IDLE; 
        updateOLED("CANH BAO", tankEmpty ? "BON CAN NUOC" : "TROI MUA TO"); 
    } return; 
  }
  
  unsigned long now = millis();
  switch (autoState) {
    case AUTO_IDLE: 
      if (Humidity <= humMin && Humidity > 0 && isMixingReady) { 
        enqueueCommand("<B:ON6>"); autoStateTimer = now; autoState = AUTO_WAIT_VALVE_ON; 
        updateOLED("AUTO TUOI", "1. Dang mo van");
      } break;
    case AUTO_WAIT_VALVE_ON: 
      if (valveState[0]) { 
        enqueueCommand("<B:ON5>"); autoStateTimer = now; autoState = AUTO_WAIT_PUMP_ON; 
        updateOLED("AUTO TUOI", "2. Dang mo bom");
      } else if (now - autoStateTimer >= 4000UL) { enqueueCommand("<B:ON6>"); autoStateTimer = now; } break;
    case AUTO_WAIT_PUMP_ON: 
      if (pumpState[4]) { 
        autoStateTimer = now; autoState = AUTO_IRRIGATING; 
        updateOLED("AUTO TUOI", "3. Dang tuoi...");
      } else if (now - autoStateTimer >= 4000UL) { enqueueCommand("<B:ON5>"); autoStateTimer = now; } break;
    case AUTO_IRRIGATING: 
      if (Humidity >= humMax || (now - autoStateTimer >= (unsigned long)timeBom * 60000UL)) { 
        enqueueCommand("<B:OFF5>"); autoStateTimer = now; autoState = AUTO_WAIT_PUMP_OFF; 
        updateOLED("AUTO TUOI", "4. Dang tat bom");
      } break;
    case AUTO_WAIT_PUMP_OFF: 
      if (!pumpState[4]) { 
        enqueueCommand("<B:OFF6>"); autoStateTimer = now; autoState = AUTO_WAIT_VALVE_OFF; 
        updateOLED("AUTO TUOI", "5. Dang tat van");
      } else if (now - autoStateTimer >= 4000UL) { enqueueCommand("<B:OFF5>"); autoStateTimer = now; } break;
    case AUTO_WAIT_VALVE_OFF: 
      if (!valveState[0]) { 
        autoStateTimer = now; 
        if (Humidity < humMax) { autoState = AUTO_RESTING; updateOLED("AUTO TUOI", "6. Dang nghi ngoi"); } 
        else { autoState = AUTO_IDLE; isMixingReady = false; updateOLED("AUTO TUOI", "Hoan thanh!"); } 
      } else if (now - autoStateTimer >= 4000UL) { enqueueCommand("<B:OFF6>"); autoStateTimer = now; } break;
    case AUTO_RESTING: 
      if (now - autoStateTimer >= (unsigned long)timeNghi * 60000UL) { autoState = AUTO_IDLE; } break;
  }
}

bool beginRequest(HTTPClient& http, const char* path) {
  if (WiFi.status() != WL_CONNECTED) return false;
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS); http.setTimeout(HTTP_TIMEOUT_MS); http.setReuse(false);
  if (!http.begin(String(BACKEND_BASE) + path)) return false;
  http.addHeader("x-api-key", DEVICE_API_KEY); return true;
}

void ackWebCommand(int id, bool success) {
  if (id < 0 || WiFi.status() != WL_CONNECTED) return; HTTPClient http;
  if (!beginRequest(http, ("/api/commands/" + String(id) + "/ack").c_str())) return;
  http.addHeader("Content-Type", "application/json"); http.POST(success ? "{\"success\":true}" : "{\"success\":false}"); http.end();
}

void pushSettingsToWeb() {
  if (WiFi.status() != WL_CONNECTED) return; DynamicJsonDocument doc(512);
  doc["phMin"] = phMin; doc["phMax"] = phMax; doc["ecMin"] = ecMin; doc["ecMax"] = ecMax;
  doc["tempMin"] = tempMin; doc["tempMax"] = tempMax; doc["humMin"] = humMin; doc["humMax"] = humMax;
  doc["timeBom"] = timeBom; doc["timeNghi"] = timeNghi;
  String body; serializeJson(doc, body); HTTPClient http;
  if (beginRequest(http, "/api/config/thresholds")) { http.addHeader("Content-Type", "application/json"); http.POST(body); http.end(); }
}

void postTelemetryToWeb() {
  if (WiFi.status() != WL_CONNECTED) return; DynamicJsonDocument doc(1024);
  xSemaphoreTake(systemMutex, portMAX_DELAY);
  doc["temperature"] = Temperature; doc["humidity"] = Humidity; doc["ph"] = pH_Value; doc["ec"] = EC_Value;
  doc["n"] = Nitrogen; doc["p"] = Phosphorus; doc["k"] = Potassium; doc["dist1"] = Dist1; doc["dist2"] = Dist2; doc["dist3"] = Dist3; doc["dist4"] = Dist4;
  doc["air_temp"] = AirTemp; doc["air_hum"] = AirHum; doc["rain"] = RainPercent; doc["slave_online"] = (lastLoraRxTime > 0 && millis() - lastLoraRxTime < LORA_ONLINE_TIMEOUT);
  xSemaphoreGive(systemMutex); doc["sensor_status"] = "OK";
  String body; serializeJson(doc, body); HTTPClient http;
  if (beginRequest(http, "/api/telemetry")) { http.addHeader("Content-Type", "application/json"); http.POST(body); http.end(); }
}

void pushDeviceStateToWeb() {
  if (WiFi.status() != WL_CONNECTED) return; DynamicJsonDocument doc(512);
  xSemaphoreTake(systemMutex, portMAX_DELAY);
  for (int i = 0; i < 5; i++) doc["pump" + String(i + 1)] = pumpState[i] ? "ON" : "OFF";
  for (int i = 0; i < 4; i++) doc["van" + String(i + 1)] = valveState[i] ? "ON" : "OFF";
  xSemaphoreGive(systemMutex);
  String body; serializeJson(doc, body); HTTPClient http;
  if (beginRequest(http, "/api/devices/state")) { http.addHeader("Content-Type", "application/json"); http.POST(body); http.end(); }
}

void pollWebCommands() {
  if (WiFi.status() != WL_CONNECTED || webCommandId != -1) return; HTTPClient http;
  if (!beginRequest(http, "/api/commands/pending?limit=1")) return;
  if (http.GET() != 200) { http.end(); return; } String response = http.getString(); http.end();
  DynamicJsonDocument doc(1024); if (deserializeJson(doc, response)) return;

  for (JsonObject cmd : doc.as<JsonArray>()) {
    int id = cmd["id"] | -1; String devId = cmd["device_id"].as<String>(); String action = cmd["action"].as<String>();
    if (id < 0) continue;
    if (devId == "mode") { safelySwitchMode(action == "AUTO" ? 1 : 0); webCommandId = id; return; }
    if (action == "ESTOP" || devId == "estop") { enqueueEmergencyStop(); webCommandId = id; return; }

    if (devId.startsWith("pump") || devId.startsWith("van")) {
      if (systemMode != 0) { setWebAckResult(id, false); return; }
      bool isON = (action == "ON"); int relayPin = -1;
      
      if (devId.startsWith("pump")) { 
          relayPin = devId.substring(4).toInt(); 
      } else if (devId.startsWith("van")) { 
          relayPin = devId.substring(3).toInt() + 5; 
      }
      
      if (relayPin >= 1 && relayPin <= 9) { 
        if (enqueueCommand(isON ? "<B:ON" + String(relayPin) + ">" : "<B:OFF" + String(relayPin) + ">")) { 
            webCommandId = id; 
        } 
        return; 
      }
    }
  }
}

void webTask(void* parameter) {
  unsigned long lastWiFiRetry = 0; 
  for (;;) {
    unsigned long now = millis(); bool currentWiFiState = (WiFi.status() == WL_CONNECTED);
    if (currentWiFiState != lastWiFiState) { lastWiFiState = currentWiFiState; xSemaphoreTake(systemMutex, portMAX_DELAY); wifiUIUpdatePending = true; xSemaphoreGive(systemMutex); }
    if (!currentWiFiState && (now - lastWiFiRetry >= 10000UL)) { lastWiFiRetry = now; WiFi.disconnect(); WiFi.begin(ssid, password); }

    bool sendAck = false; int ackId = -1; bool ackSuccess = false;
    xSemaphoreTake(systemMutex, portMAX_DELAY);
    if (webAckPending) { sendAck = true; ackId = webAckId; ackSuccess = webAckSuccess; webAckPending = false; webAckId = -1; }
    xSemaphoreGive(systemMutex);

    if (sendAck) ackWebCommand(ackId, ackSuccess);
    if (now - lastWebPoll >= WEB_POLL_INTERVAL) { lastWebPoll = now; pollWebCommands(); }
    if ((telemetryPending || now - lastTelemetryPost >= TELEMETRY_INTERVAL) && currentWiFiState) { lastTelemetryPost = now; telemetryPending = false; postTelemetryToWeb(); }
    if (settingsPending && currentWiFiState) { settingsPending = false; pushSettingsToWeb(); }
    if ((deviceStatePending || now - lastStatePush >= STATE_PUSH_INTERVAL) && currentWiFiState) { lastStatePush = now; deviceStatePending = false; pushDeviceStateToWeb(); }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

void processLoRaData(const String& incomingData) {
  if (!incomingData.startsWith("<A:DATA:") || !incomingData.endsWith(">")) return;
  String raw = incomingData.substring(8, incomingData.length() - 1);
  xSemaphoreTake(systemMutex, portMAX_DELAY);
  
  Temperature = getValue(raw, ',', 0).toFloat(); Humidity = getValue(raw, ',', 1).toFloat();
  EC_Value = getValue(raw, ',', 2).toFloat(); // Sửa thành toFloat() cho EC
  pH_Value = getValue(raw, ',', 3).toFloat();
  Nitrogen = getValue(raw, ',', 4).toInt(); Phosphorus = getValue(raw, ',', 5).toInt();
  Potassium = getValue(raw, ',', 6).toInt(); Dist1 = getValue(raw, ',', 7).toFloat(); 
  Dist2 = getValue(raw, ',', 8).toFloat(); Dist3 = getValue(raw, ',', 9).toFloat(); Dist4 = getValue(raw, ',', 10).toFloat();
  RainPercent = getValue(raw, ',', 11).toInt(); AirTemp = getValue(raw, ',', 12).toFloat(); AirHum = getValue(raw, ',', 13).toFloat();
  
  if (systemMode == 1 && lastLoraRxTime == 0) updateOLED("CHE DO AUTO", "Dang hoat dong");
  lastLoraRxTime = millis(); xSemaphoreGive(systemMutex);
  updateDashboard(); telemetryPending = true;
}

void processLoRaSync(const String& incomingData) {
  if (!incomingData.startsWith("<B:SYNC:") || !incomingData.endsWith(">")) return;
  String content = incomingData.substring(8, incomingData.length() - 1);
  int equalIdx = content.indexOf('='); if (equalIdx < 0) return;
  String devName = content.substring(0, equalIdx); 
  int stateVal = content.substring(equalIdx + 1).toInt(); bool isOn = (stateVal == 1);
  
  xSemaphoreTake(systemMutex, portMAX_DELAY);
  if (devName == "MODE") { 
    systemMode = stateVal; 
    if (systemMode == 0) { 
        for (int i = 0; i < 5; i++) pumpState[i] = false; 
        for (int i = 0; i < 4; i++) valveState[i] = false; 
    } 
  } 
  else if (devName.startsWith("BOM")) { 
    int num = devName.substring(3).toInt(); 
    if (num >= 1 && num <= 5) pumpState[num - 1] = isOn; 
  } 
  else if (devName.startsWith("VAN")) { 
    int num = devName.substring(3).toInt(); 
    if (num >= 1 && num <= 4) valveState[num - 1] = isOn; 
  }
  xSemaphoreGive(systemMutex); 
  
  updateNextionControlStates(); 
  updateDashboard(); 
  deviceStatePending = true;
}

String espLoraRxBuffer = "";

void handleLoraIncoming() {
  while (loraSerial.available()) {
    char c = loraSerial.read();
    
    if (c == '\n' || c == '\r') {
      espLoraRxBuffer.trim();
      if (espLoraRxBuffer.length() > 0) {
        
        processLoRaData(espLoraRxBuffer); 
        processLoRaSync(espLoraRxBuffer); 

        if (isWaitingAck) {
          char nodeTag = currentCommand.charAt(1); 
          int colonIdx = currentCommand.indexOf(':');
          String cmdBody = currentCommand.substring(colonIdx + 1, currentCommand.length() - 1); 
          bool isAck = false;

          if (nodeTag == 'A') {
            if (cmdBody == "GET_DATA" && espLoraRxBuffer.startsWith("<A:DATA:")) isAck = true;
          } else if (nodeTag == 'B') {
            if (espLoraRxBuffer.startsWith("<B:ACK_" + cmdBody + ">")) isAck = true;
          }

          if (isAck) {
              applyConfirmedState(cmdBody);
              isWaitingAck = false; 
              retryCount = 0;
              if (webCommandId >= 0) setWebAckResult(webCommandId, true);
              currentCommand = ""; 
              if(cmdBody != "GET_DATA") updateOLED("TRANG THAI: OK", "Da phan hoi");
              lastSendTime = millis() - INTER_CMD_DELAY; 
          }
        }
      }
      espLoraRxBuffer = "";
    } else {
      espLoraRxBuffer += c;
      if (espLoraRxBuffer.length() > 300) espLoraRxBuffer = "";
    }
  }
}

void updateNextionSettingsPage() {
  sendText("t0.txt", String(phMin, 1)); sendText("t1.txt", String(phMax, 1)); sendText("t2.txt", String(ecMin, 1)); sendText("t3.txt", String(ecMax, 1));
  sendText("t4.txt", String(tempMin, 1)); sendText("t5.txt", String(tempMax, 1)); sendText("t6.txt", String(humMin, 1)); sendText("t7.txt", String(humMax, 1));
  sendText("t8.txt", String(timeBom)); sendText("t9.txt", String(timeNghi));
}

void processNextionCommand(String rawCmd) {
  String cleanCmd = ""; for (int i = 0; i < rawCmd.length(); i++) { char c = rawCmd.charAt(i); if (c >= 32 && c <= 126) cleanCmd += c; }
  if (cleanCmd.length() == 0) return; String cmdUpper = cleanCmd; cmdUpper.toUpperCase();

  if (cmdUpper.startsWith("CHECK_PASS=")) {
    String entered = cmdUpper.substring(11); entered.trim(); systemPassword.trim();
    if (entered == systemPassword) sendNextionCmd("page page1"); else { sendNextionCmd("va0.val=1"); sendNextionCmd("t0.pw=0"); sendNextionCmd("t0.pco=63488"); sendNextionCmd("t0.txt=\"X\""); } return;
  }
  if (cmdUpper.startsWith("CHGPASS=")) {
    String data = cmdUpper.substring(8); int f = data.indexOf(','), s = data.lastIndexOf(',');
    if (f >= 0 && s > f) {
      String op = data.substring(0, f), np1 = data.substring(f + 1, s), np2 = data.substring(s + 1); op.trim(); np1.trim(); np2.trim();
      if (op != systemPassword) { sendNextionCmd("t0.pw=0"); sendNextionCmd("t0.pco=63488"); sendNextionCmd("t0.txt=\"X\""); }
      else if (np1 != np2) { sendNextionCmd("t2.pw=0"); sendNextionCmd("t2.pco=63488"); sendNextionCmd("t2.txt=\"X\""); }
      else { systemPassword = np1; preferences.begin("system_data", false); preferences.putString("password", systemPassword); preferences.end(); sendNextionCmd("page page0"); }
    } return;
  }
  if (cmdUpper == "CMD=MODE_AUTO") { safelySwitchMode(1); return; }
  if (cmdUpper == "CMD=MODE_MANUAL") { safelySwitchMode(0); return; }
  if (cmdUpper.indexOf("ESTOP") >= 0 || cmdUpper.indexOf("DUNGKHANCAP") >= 0) { enqueueEmergencyStop(); return; }

  if (cmdUpper == "CMD=GET_DATA" || cmdUpper == "B2" || cmdUpper == "CMD=B2") {
    if (!isCommandInQueue("<A:GET_DATA>")) {
      enqueueCommand("<A:GET_DATA>");
      updateOLED("LORA TX:", "Yeu cau Data"); 
    }
    return;
  }

  if (cmdUpper.startsWith("BOM")) {
    int eqRaw = rawCmd.indexOf('='); 
    if (eqRaw >= 0 && eqRaw + 1 < rawCmd.length()) {
      int eqClean = cmdUpper.indexOf('='); int num = cmdUpper.substring(3, eqClean).toInt();
      char valChar = rawCmd.charAt(eqRaw + 1); bool isOn = (valChar == '1' || valChar == 0x01 || valChar == 'O' || valChar == 'o'); 
      if (systemMode == 0) {
        enqueueCommand(isOn ? "<B:ON" + String(num) + ">" : "<B:OFF" + String(num) + ">");
      } else updateNextionControlStates(); 
    } return;
  }
  if (cmdUpper.startsWith("VAN")) {
    int eqRaw = rawCmd.indexOf('='); 
    if (eqRaw >= 0 && eqRaw + 1 < rawCmd.length()) {
      int eqClean = cmdUpper.indexOf('='); int num = cmdUpper.substring(3, eqClean).toInt();
      char valChar = rawCmd.charAt(eqRaw + 1); bool isOn = (valChar == '1' || valChar == 0x01 || valChar == 'O' || valChar == 'o'); 
      if (systemMode == 0) {
        int relay = num + 5; 
        enqueueCommand(isOn ? "<B:ON" + String(relay) + ">" : "<B:OFF" + String(relay) + ">");
      } else updateNextionControlStates();
    } return;
  }

  if (cmdUpper.indexOf("DASHBOARD_READY") >= 0) { updateWiFiIcon(); updateDashboard(); return; }
  if (cmdUpper.indexOf("MENU_READY") >= 0 || cmdUpper.indexOf("ABOUT_READY") >= 0) { updateWiFiIcon(); return; }
  if (cmdUpper.indexOf("SETTINGS_READY") >= 0) { updateWiFiIcon(); updateNextionSettingsPage(); return; }
  if (cmdUpper.indexOf("CONTROL_READY") >= 0) { updateWiFiIcon(); updateNextionControlStates(); return; }

  if (cmdUpper.startsWith("SAVE=")) {
    String data = cmdUpper.substring(5);
    float nPhMin = getValue(data, ',', 0).toFloat(), nPhMax = getValue(data, ',', 1).toFloat();
    float nEcMin = getValue(data, ',', 2).toFloat(), nEcMax = getValue(data, ',', 3).toFloat();
    float nTempMin = getValue(data, ',', 4).toFloat(), nTempMax = getValue(data, ',', 5).toFloat();
    float nHumMin = getValue(data, ',', 6).toFloat(), nHumMax = getValue(data, ',', 7).toFloat();
    int nTimeBom = getValue(data, ',', 8).toInt(), nTimeNghi = getValue(data, ',', 9).toInt();

    if (nPhMin >= nPhMax || nEcMin >= nEcMax || nTempMin >= nTempMax || nHumMin >= nHumMax || nTimeBom <= 0 || nTimeNghi < 0) { updateNextionSettingsPage(); return; }
    phMin = nPhMin; phMax = nPhMax; ecMin = nEcMin; ecMax = nEcMax; tempMin = nTempMin; tempMax = nTempMax; humMin = nHumMin; humMax = nHumMax; timeBom = nTimeBom; timeNghi = nTimeNghi;
    preferences.begin("system_data", false);
    preferences.putFloat("phMin", phMin); preferences.putFloat("phMax", phMax); preferences.putFloat("ecMin", ecMin); preferences.putFloat("ecMax", ecMax);
    preferences.putFloat("tempMin", tempMin); preferences.putFloat("tempMax", tempMax); preferences.putFloat("humMin", humMin); preferences.putFloat("humMax", humMax);
    preferences.putInt("timeBom", timeBom); preferences.putInt("timeNghi", timeNghi); preferences.end();
    enqueueCommand("<SET_DATA=" + data + ">"); settingsPending = true; updateNextionSettingsPage(); return;
  }

  if (cmdUpper.indexOf("CMD=REBOOT") >= 0) { updateOLED("SYSTEM", "Rebooting..."); sendNextionCmd("page page0"); delay(1000); ESP.restart(); }
  if (cmdUpper.indexOf("CMD=RESTORE") >= 0) {
    phMin = 5.5; phMax = 6.5; ecMin = 1.0; ecMax = 2.0; tempMin = 22.0; tempMax = 35.0; humMin = 65.0; humMax = 80.0; timeBom = 10; timeNghi = 15;
    preferences.begin("system_data", false);
    preferences.putFloat("phMin", phMin); preferences.putFloat("phMax", phMax); preferences.putFloat("ecMin", ecMin); preferences.putFloat("ecMax", ecMax);
    preferences.putFloat("tempMin", tempMin); preferences.putFloat("tempMax", tempMax); preferences.putFloat("humMin", humMin); preferences.putFloat("humMax", humMax);
    preferences.putInt("timeBom", timeBom); preferences.putInt("timeNghi", timeNghi); preferences.end();
    updateNextionSettingsPage(); enqueueCommand("<SET_DATA=5.5,6.5,1.0,2.0,22.0,35.0,65.0,80.0,10,15>"); settingsPending = true; return;
  }
}

void handleNextionIncoming() {
  while (nextion.available()) { String rawCmd = nextion.readStringUntil('\n'); if (rawCmd.length() > 0) processNextionCommand(rawCmd); }
}

void setup() {
  Serial.begin(115200); systemMutex = xSemaphoreCreateMutex(); queueMutex = xSemaphoreCreateMutex();
  Wire.begin(I2C_SDA, I2C_SCL); if (display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) { display.setRotation(2); updateOLED("MASTER BOOT", "Khoi tao..."); }
  pinMode(LORA_M0, OUTPUT); pinMode(LORA_M1, OUTPUT); pinMode(LORA_AUX, INPUT);
  digitalWrite(LORA_M0, LOW); digitalWrite(LORA_M1, LOW);
  unsigned long auxStart = millis(); while (digitalRead(LORA_AUX) == LOW && (millis() - auxStart < 3000UL)) delay(10);
  loraSerial.setRxBufferSize(512); loraSerial.begin(9600, SERIAL_8N1, LORA_RX_PIN, LORA_TX_PIN); loraSerial.setTimeout(20); 
  while (loraSerial.available()) loraSerial.read();
  nextion.begin(115200, SERIAL_8N1, NEXTION_RX, NEXTION_TX); nextion.setTimeout(20); delay(500); while (nextion.available()) nextion.read();
  preferences.begin("system_data", false); systemPassword = preferences.getString("password", "123456"); phMin = preferences.getFloat("phMin", 5.5); phMax = preferences.getFloat("phMax", 6.5); ecMin = preferences.getFloat("ecMin", 1.0); ecMax = preferences.getFloat("ecMax", 2.0); tempMin = preferences.getFloat("tempMin", 22.0); tempMax = preferences.getFloat("tempMax", 35.0); humMin = preferences.getFloat("humMin", 65.0); humMax = preferences.getFloat("humMax", 80.0); timeBom = preferences.getInt("timeBom", 10); timeNghi = preferences.getInt("timeNghi", 15); preferences.end();
  WiFi.mode(WIFI_STA); WiFi.begin(ssid, password); updateOLED("WIFI", "Connecting...");
  int wifiAttempts = 0; while (WiFi.status() != WL_CONNECTED && wifiAttempts < 20) { delay(500); wifiAttempts++; }
  if (WiFi.status() == WL_CONNECTED) { configTime(gmtOffset_sec, daylightOffset_sec, ntpServer); updateOLED("MASTER READY", "WiFi Connected"); } else updateOLED("MASTER READY", "WiFi Offline");
  sendNextionCmd("page page0"); xTaskCreatePinnedToCore(webTask, "WebTask", 12288, NULL, 1, &webTaskHandle, 0);
}

void loop() {
  handleLoraIncoming(); 
  processLoRaQueue(); 
  handleAutoMixingLogic(); 
  handleAutoIrrigationLogic(); 
  handleNextionIncoming();

  if (systemMode == 1) { 
    if (millis() - lastSensorPollTime >= AUTO_POLL_INTERVAL) { 
        lastSensorPollTime = millis(); 
        if (!isCommandInQueue("<A:GET_DATA>")) {
            enqueueCommand("<A:GET_DATA>"); 
        }
    } 
  }
  
  if (millis() - lastUpdate >= 1000UL) { lastUpdate = millis(); updateClock(); }
  bool needWiFiUpdate = false; 
  xSemaphoreTake(systemMutex, portMAX_DELAY); 
  if (wifiUIUpdatePending) { needWiFiUpdate = true; wifiUIUpdatePending = false; } 
  xSemaphoreGive(systemMutex);
  
  if (needWiFiUpdate) { 
      updateWiFiIcon(); 
      if (systemMode != 1) updateOLED("MASTER READY", WiFi.status() == WL_CONNECTED ? "WiFi Connected" : "WiFi Offline"); 
  }
  delay(5);
}