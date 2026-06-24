/*
 * ESP32 MASTER  <->  Node.js backend  (reference sketch)
 * --------------------------------------------------------
 * Shows the HTTP contract the backend expects. The LoRa <-> Slave part is
 * left as comments where your existing LoRa code goes.
 *
 * Flow:
 *   1. Receive sensor data from Slave over LoRa.
 *   2. POST it to  /api/telemetry
 *   3. Poll        /api/commands/pending   -> relay each command to Slave via LoRa
 *   4. POST        /api/commands/{id}/ack  once the Slave confirms
 *   5. (optional)  POST /api/devices/state with the real relay states
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

unsigned long lastPost = 0;
unsigned long lastPoll = 0;

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
  // initLoRa();  // <-- your existing LoRa setup
}

void loop() {
  unsigned long now = millis();

  // ---- 1+2. Every 5s: read sensors from Slave (LoRa) and POST telemetry ----
  if (now - lastPost > 5000) {
    lastPost = now;

    // float temperature = loraData.temperature; (etc.) — filled from LoRa packet
    float temperature = 32.5, humidity = 78, ph = 6.45, ec = 1.82;
    int   rssi        = -72;          // LoRa.packetRssi();
    bool  slaveOnline = true;

    postTelemetry(temperature, humidity, ph, ec, rssi, slaveOnline);
  }

  // ---- 3+4. Every 2s: poll for pending commands and relay them ----
  if (now - lastPoll > 2000) {
    lastPoll = now;
    pollCommands();
  }
}

void postTelemetry(float t, float h, float ph, float ec, int rssi, bool slaveOnline) {
  HTTPClient http;
  http.begin(String(BASE) + "/api/telemetry");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", APIKEY);

  StaticJsonDocument<256> doc;
  doc["temperature"]  = t;
  doc["humidity"]     = h;
  doc["ph"]           = ph;
  doc["ec"]           = ec;
  doc["lora_rssi"]    = rssi;
  doc["slave_online"] = slaveOnline;

  String body; serializeJson(doc, body);
  int code = http.POST(body);
  Serial.printf("POST /telemetry -> %d\n", code);
  http.end();
}

void pollCommands() {
  HTTPClient http;
  http.begin(String(BASE) + "/api/commands/pending");
  http.addHeader("x-api-key", APIKEY);
  int code = http.GET();
  if (code == 200) {
    StaticJsonDocument<1024> doc;
    deserializeJson(doc, http.getString());
    for (JsonObject cmd : doc.as<JsonArray>()) {
      int         id     = cmd["id"];
      const char* devId  = cmd["device_id"];  // "pump","van1".. or "mode"
      const char* action = cmd["action"];     // "ON"/"OFF" or "AUTO"/"MANUAL"
      Serial.printf("CMD #%d: %s -> %s\n", id, devId, action);

      // sendToSlaveViaLoRa(devId, action);   // <-- your LoRa TX
      // bool ok = waitSlaveAck();             // <-- wait for slave confirmation

      ackCommand(id);                          // tell the backend it's done
    }
  }
  http.end();
}

void ackCommand(int id) {
  HTTPClient http;
  http.begin(String(BASE) + "/api/commands/" + id + "/ack");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", APIKEY);
  int code = http.POST("{\"success\":true}");
  Serial.printf("POST /commands/%d/ack -> %d\n", id, code);
  http.end();
}
