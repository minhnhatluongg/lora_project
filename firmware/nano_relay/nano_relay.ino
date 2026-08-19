#include <SoftwareSerial.h>

SoftwareSerial uart(A3, A2);       
SoftwareSerial loraSerial(11, 12); 
#define LORA_AUX 10                

const byte relayPins[]  = {A1, A0, 2, 3, 4, 5, 6, 7, 8, 9};
const int TOTAL_RELAYS = 10;

String pendingAck = "";
unsigned long ackWaitStart = 0;
int currentMode = 0; // 0: MANUAL, 1: AUTO - Lưu trạng thái chế độ để khóa phím tủ điện

void sendLoraMessage(String msg) {
  uart.stopListening();
  loraSerial.listen();
  while (digitalRead(LORA_AUX) == LOW) { delay(1); } 
  loraSerial.println(msg);
  Serial.println(">> [TX LORA] " + msg);
  delay(15); 
  while (digitalRead(LORA_AUX) == LOW) { delay(1); } 
}

void sendLoraSync(int relayIndex, bool isOn) {
  String devTag = "";
  if (relayIndex >= 0 && relayIndex <= 4) devTag = "BOM" + String(relayIndex + 1);
  else if (relayIndex >= 5 && relayIndex <= 8) devTag = "VAN" + String(relayIndex - 4);
  else return;
  pendingAck = "<B:SYNC:" + devTag + "=" + (isOn ? "1" : "0") + ">";
  ackWaitStart = millis();
}

void sendLoraModeSync(int modeVal) {
  pendingAck = "<B:SYNC:MODE=" + String(modeVal) + ">";
  ackWaitStart = millis();
}

void turnOn(int index, String sourceCmd) {
  digitalWrite(relayPins[index], HIGH);
  Serial.println("[BAT] Relay " + String(index + 1));
  if (sourceCmd.startsWith("D") || sourceCmd == "TU_DIEN") sendLoraSync(index, true);
}

void turnOff(int index, String sourceCmd) {
  digitalWrite(relayPins[index], LOW);
  Serial.println("[TAT] Relay " + String(index + 1));
  if (sourceCmd.startsWith("D") || sourceCmd == "TU_DIEN") sendLoraSync(index, false);
}

void processLoraCommand(String cmd) {
  if (!cmd.startsWith("<B:") || !cmd.endsWith(">")) return;
  String body = cmd.substring(3, cmd.length() - 1); 
  Serial.println("\n>> [RX LORA] <B:" + body + ">");

  if (body == "ESTOP") {
    for (int i = 0; i < TOTAL_RELAYS; i++) digitalWrite(relayPins[i], LOW);
    currentMode = 0; // Reset về Manual khi khẩn cấp
  }
  else if (body == "SET_MODE=AUTO") { turnOn(9, "LORA"); currentMode = 1; }
  else if (body == "SET_MODE=MANUAL") { turnOff(9, "LORA"); currentMode = 0; }
  else if (body.startsWith("ON")) {
    int relayNum = body.substring(2).toInt();
    if (relayNum >= 1 && relayNum <= TOTAL_RELAYS) turnOn(relayNum - 1, "LORA");
  }
  else if (body.startsWith("OFF")) {
    int relayNum = body.substring(3).toInt();
    if (relayNum >= 1 && relayNum <= TOTAL_RELAYS) turnOff(relayNum - 1, "LORA");
  }

  pendingAck = "<B:ACK_" + body + ">";
  ackWaitStart = millis();
}

void setup() {
  Serial.begin(9600);
  for (int i = 0; i < TOTAL_RELAYS; i++) { digitalWrite(relayPins[i], LOW); pinMode(relayPins[i], OUTPUT); }
  pinMode(LORA_AUX, INPUT_PULLUP);
  loraSerial.begin(9600);
  uart.begin(9600);
  uart.listen(); 
}

void loop() {
  if (pendingAck != "" && (millis() - ackWaitStart >= 100)) {
    sendLoraMessage(pendingAck);
    pendingAck = "";
  }

  if (digitalRead(LORA_AUX) == LOW) {
    if (!loraSerial.isListening()) { uart.stopListening(); loraSerial.listen(); }
    unsigned long waitStart = millis();
    while (digitalRead(LORA_AUX) == LOW || loraSerial.available()) {
      if (loraSerial.available()) {
        String s = loraSerial.readStringUntil('\n'); s.trim();
        if (s.startsWith("<B:") && s.endsWith(">")) processLoraCommand(s);
      }
      if (millis() - waitStart > 1000) break; 
    }
  }
  else {
    if (!uart.isListening() && pendingAck == "") { loraSerial.stopListening(); uart.listen(); }
    if (uart.available()) {
      String s = uart.readStringUntil('\n'); s.trim();
      if (s.length() == 0) return;

      // Nút Mode luôn được phép bấm ở bất kỳ chế độ nào
      if (s == "A0_ON") { turnOn(9, "TU_DIEN"); sendLoraModeSync(1); currentMode = 1; }
      else if (s == "A0_OFF") { turnOff(9, "TU_DIEN"); sendLoraModeSync(-1); currentMode = 0; }
      else if (s == "A1_ON") { turnOff(9, "TU_DIEN"); sendLoraModeSync(0); currentMode = 0; }
      else if (s == "A1_OFF") { sendLoraModeSync(-1); }
      // KHÓA các phím vật lý điều khiển Relay nếu đang ở chế độ AUTO (currentMode == 1)
      else if (currentMode == 0) {
        if      (s == "D2")  turnOn(0, s);  else if (s == "D7")  turnOff(0, s);
        else if (s == "D3")  turnOn(1, s);  else if (s == "D8")  turnOff(1, s);
        else if (s == "D4")  turnOn(2, s);  else if (s == "D9")  turnOff(2, s);
        else if (s == "D5")  turnOn(3, s);  else if (s == "D10") turnOff(3, s);
        else if (s == "D6")  turnOn(4, s);  else if (s == "D11") turnOff(4, s);
        else if (s == "D12_ON") turnOn(5, s);  else if (s == "D12_OFF") turnOff(5, s);
        else if (s == "D13_ON") turnOn(6, s);  else if (s == "D13_OFF") turnOff(6, s);
        else if (s == "D14_ON") turnOn(7, s);  else if (s == "D14_OFF") turnOff(7, s);
        else if (s == "D15_ON") turnOn(8, s);  else if (s == "D15_OFF") turnOff(8, s);
      }
    }
  }
}