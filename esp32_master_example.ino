/*
 * ESP32 MASTER  <->  Node.js backend  (reference sketch)
 * --------------------------------------------------------
 * Bridges the STM32 sensor node to the backend.
 *
 * Wiring (UART link to the STM32F411):
 *   STM32 PA2 (TX) ──► ESP32 GPIO16 (RX2)
 *   STM32 PA3 (RX) ◄── ESP32 GPIO17 (TX2)
 *   GND ─────────────── GND          (common ground is required)
 *
 * The STM32 prints ONE line of JSON per reading cycle (see sendUplink() in
 * testcode/src/main.cpp), e.g.:
 *   {"temperature":31.2,"humidity":45.6,"ph":6.5,"ec":1200,"n":118,"p":57,
 *    "k":190,"dist1":42.5,"dist2":88.0,"dist3":31.2,"dist4":-1,"sensor_status":"OK"}
 *
 * Flow:
 *   1. Read that line off Serial2.
 *   2. Add the radio/link fields this side knows about and POST /api/telemetry.
 *   3. Poll  /api/commands/pending  -> relay each command to the actuators.
 *   4. POST  /api/commands/{id}/ack once executed.
 *   5. (optional) POST /api/devices/state with the real relay states.
 *
 * Libraries: WiFi.h, HTTPClient.h, ArduinoJson (v6+)
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASS";

// Point this at the machine running the Node backend (NOT localhost).
const char* BASE   = "http://192.168.1.100:4000";
const char* APIKEY = "changeme-esp32-secret";   // must match DEVICE_API_KEY in backend/.env

// UART2 <-> STM32 sensor node
#define STM32_RX_PIN 16
#define STM32_TX_PIN 17
HardwareSerial& STM32_Serial = Serial2;

// If the STM32 goes quiet for this long, raise one alert so the dashboard can
// tell "the sensor node died" apart from "the ESP32 lost WiFi".
const unsigned long NODE_TIMEOUT_MS = 15000;

unsigned long lastLine = 0;
unsigned long lastPoll = 0;
bool nodeAlerted = false;
String lineBuf;

// HTTP must never block long: the STM32 keeps streaming into the UART FIFO the
// whole time, and a stalled request would overflow it and corrupt lines.
const uint16_t HTTP_CONNECT_TIMEOUT_MS = 1500;
const uint16_t HTTP_TIMEOUT_MS = 2500;

// One JSON line is ~200 bytes and arrives every ~2.5 s. The default 256-byte
// RX buffer leaves no slack if a request runs long, so give it room for several.
const size_t UART_RX_BUFFER = 1024;

void setup() {
  Serial.begin(115200);
  STM32_Serial.setRxBufferSize(UART_RX_BUFFER);   // must be called BEFORE begin()
  STM32_Serial.begin(115200, SERIAL_8N1, STM32_RX_PIN, STM32_TX_PIN);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
  // initLoRa();  // <-- if the node is remote, your LoRa setup goes here and
  //                    you feed handleUplink() with the received packet instead.
}

void loop() {
  // ---- 1+2. Drain the UART; every complete line is one full sensor sweep ----
  while (STM32_Serial.available()) {
    char c = STM32_Serial.read();
    if (c == '\n') {
      handleUplink(lineBuf);
      lineBuf = "";
    } else if (c != '\r' && lineBuf.length() < 400) {
      lineBuf += c;
    }
  }

  // ---- 3+4. Every 2s: poll for pending commands and relay them ----
  if (millis() - lastPoll > 2000) {
    lastPoll = millis();
    pollCommands();
  }

  // ---- 5. Watchdog: the node stopped talking ----
  if (lastLine > 0 && millis() - lastLine > NODE_TIMEOUT_MS && !nodeAlerted) {
    nodeAlerted = true;
    postAlert("danger", "Mat ket noi UART voi node STM32");
  }
}

// Shared setup for every request: short timeouts, no keep-alive surprises.
void beginRequest(HTTPClient& http, const char* path) {
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);
  http.begin(String(BASE) + path);
  http.addHeader("x-api-key", APIKEY);
}

// Parse one STM32 line, enrich it with what this side knows, and forward it.
void handleUplink(const String& line) {
  if (line.length() < 2 || line[0] != '{') return;   // ignore boot noise

  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, line);
  if (err) {
    Serial.printf("uplink parse error: %s\n", err.c_str());
    return;
  }

  // The node is alive even if we can't reach the backend right now, so mark it
  // here rather than after a possibly-failing POST.
  lastLine = millis();
  nodeAlerted = false;

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi down, dropping this reading");
    return;
  }

  // Fields only the master knows. The STM32 supplies everything else verbatim,
  // including sensor_status and the -1 markers for silent ultrasonic sensors —
  // the backend turns those into nulls. When the soil probe has never answered,
  // the STM32 omits the 7 soil fields entirely and the backend stores nulls.
  doc["lora_rssi"]    = WiFi.RSSI();   // or LoRa.packetRssi() on a radio link
  doc["slave_online"] = true;          // a line just arrived, so the node is alive

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  beginRequest(http, "/api/telemetry");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  Serial.printf("POST /telemetry -> %d\n", code);
  http.end();
}

void pollCommands() {
  // WiFi can drop without the sketch noticing; skip the 4 s of timeouts.
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  beginRequest(http, "/api/commands/pending");
  int code = http.GET();
  if (code == 200) {
    StaticJsonDocument<1024> doc;
    deserializeJson(doc, http.getString());
    for (JsonObject cmd : doc.as<JsonArray>()) {
      int         id     = cmd["id"];
      const char* devId  = cmd["device_id"];  // "pump","van1".. or "mode"
      const char* action = cmd["action"];     // "ON"/"OFF" or "AUTO"/"MANUAL"
      Serial.printf("CMD #%d: %s -> %s\n", id, devId, action);

      bool ok = true;
      // ok = driveRelay(devId, action);     // <-- your relay / LoRa TX here
      // ok = waitSlaveAck();                // <-- wait for confirmation

      ackCommand(id, ok);                    // tell the backend how it went
    }
  }
  http.end();
}

void postAlert(const char* level, const char* message) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  beginRequest(http, "/api/alerts");
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<192> doc;
  doc["level"]   = level;   // info | warning | danger
  doc["message"] = message;
  String body; serializeJson(doc, body);

  int code = http.POST(body);
  Serial.printf("POST /alerts -> %d\n", code);
  http.end();
}

// Pass success=false when the actuator did not actually change — the backend
// then frees the device instead of retrying the same command three times.
void ackCommand(int id, bool success) {
  HTTPClient http;
  beginRequest(http, (String("/api/commands/") + id + "/ack").c_str());
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(success ? "{\"success\":true}" : "{\"success\":false}");
  Serial.printf("POST /commands/%d/ack -> %d\n", id, code);
  http.end();
}
