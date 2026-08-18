// Chuoi hang trong Serial.print duoc boc F() de nam o FLASH thay vi RAM.
// ATmega328P chi co 2KB RAM; ban chua boc dung 1825 byte (89%) va chi con 223
// byte cho stack, trong khi code nay dung String rat nhieu - heap lon len dung
// stack la reset ngau nhien giua chung, dung luc dang dieu khien relay.
#include <SoftwareSerial.h>

// 1. CỔNG UART NANO 1 (TỦ ĐIỆN)
SoftwareSerial uart(A3, A2);       // RX=A3, TX=A2

// 2. CỔNG LORA E32 (NHẬN TỪ ESP32 MASTER)
SoftwareSerial loraSerial(11, 12); // RX=D11, TX=D12
#define LORA_AUX 10                // D10: Chân AUX LoRa

// =================================================================
// DANH SÁCH 10 CHÂN RELAY (A1 = Relay 1, A0 = Relay 2, D2..D9 = Relay 3..10)
// =================================================================
const byte relayPins[]  = {A1, A0, 2, 3, 4, 5, 6, 7, 8, 9};
const char* relayNames[]= {"A1", "A0", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"};

const int TOTAL_RELAYS = 10;

bool isAutoMode   = false;
bool isManualMode = false;
String loraBuffer = "";

// =================================================================
// HÀM GỬI ACK PHẢN HỒI VỀ ESP32 MASTER
// =================================================================
void sendLoraAck(String receivedCmd) {
  String ackMsg = "<ACK_" + receivedCmd.substring(1);

  uart.stopListening();
  loraSerial.listen();
  
  while (digitalRead(LORA_AUX) == LOW) { delay(2); }
  
  loraSerial.println(ackMsg);
  delay(20);
  
  loraSerial.stopListening();
  uart.listen();

  Serial.println(">> [LORA TX -> ESP32] Đã gửi ACK: " + ackMsg);
}

// =================================================================
// HÀM GỬI NACK (LỆNH BỊ TỪ CHỐI - khóa an toàn hoặc desync mode)
// Dùng thay cho ACK giả để ESP32 biết chính xác lệnh có được thực thi
// hay không, thay vì cứ tưởng thành công rồi chạy tiếp state machine.
// =================================================================
void sendLoraNack(String receivedCmd) {
  String nackMsg = "<NACK_" + receivedCmd.substring(1);

  uart.stopListening();
  loraSerial.listen();

  while (digitalRead(LORA_AUX) == LOW) { delay(2); }

  loraSerial.println(nackMsg);
  delay(20);

  loraSerial.stopListening();
  uart.listen();

  Serial.println(">> [LORA TX -> ESP32] Đã gửi NACK: " + nackMsg);
}

// =================================================================
// HÀM GỬI SYNC CÓ ACK + RETRY (thay cho fire-and-forget trước đây)
// Nếu gói SYNC bị mất do va chạm sóng, hàm này tự phát hiện (không
// nhận được <SYNC_ACK> trong 300ms) và gửi lại tối đa 3 lần.
// =================================================================
bool sendLoraSyncReliable(String syncMsg) {
  uart.stopListening();
  loraSerial.listen();

  bool acked = false;
  for (int attempt = 0; attempt < 3 && !acked; attempt++) {
    while (digitalRead(LORA_AUX) == LOW) { delay(2); }
    loraSerial.println(syncMsg);
    delay(20);

    unsigned long start = millis();
    String rxBuf = "";
    while (millis() - start < 300) {   // chờ SYNC_ACK tối đa 300ms
      if (loraSerial.available()) {
        char c = loraSerial.read();
        if (c == '\n') {
          rxBuf.trim();
          if (rxBuf.indexOf("SYNC_ACK") >= 0) { acked = true; break; }
          rxBuf = "";
        } else if (c != '\r') {
          rxBuf += c;
        }
      }
    }
    if (!acked) delay(50); // nghỉ ngắn trước khi thử lại
  }

  loraSerial.stopListening();
  uart.listen();

  if (!acked) {
    Serial.println(">> [SYNC] KHONG NHAN DUOC ACK sau 3 lan: " + syncMsg);
  }
  return acked;
}

// =================================================================
// HÀM GỬI ĐỒNG BỘ TRẠNG THÁI (BƠM/VAN) LÊN HMI NEXTION QUA ESP32
// Bảng mapping: relayIndex 0-4 = BOM1-5, relayIndex 5-8 = VAN1-4
// (khớp với cách ESP32 đánh số pump[0..4]/valve[0..3] và processLoRaSync())
// =================================================================
void sendLoraSync(int relayIndex, bool isOn) {
  String devTag = "";
  
  if      (relayIndex == 0) devTag = "BOM1";
  else if (relayIndex == 1) devTag = "BOM2";
  else if (relayIndex == 2) devTag = "BOM3";
  else if (relayIndex == 3) devTag = "BOM4";
  else if (relayIndex == 4) devTag = "BOM5";
  else if (relayIndex == 5) devTag = "VAN1";
  else if (relayIndex == 6) devTag = "VAN2";
  else if (relayIndex == 7) devTag = "VAN3";
  else if (relayIndex == 8) devTag = "VAN4";
  else return;

  String syncMsg = "<SYNC:" + devTag + "=" + (isOn ? "1" : "0") + ">";
  sendLoraSyncReliable(syncMsg);
  Serial.println(">> [TX SYNC -> HMI] Đã đồng bộ thiết bị: " + syncMsg);
}

// Bổ sung: Hàm gửi đồng bộ Chế độ Tự động / Thủ công từ công tắc xoay
void sendLoraModeSync(int modeVal) {
  // modeVal: 1 = AUTO, 0 = MANUAL, -1 = STOP
  String syncMsg = "<SYNC:MODE=" + String(modeVal) + ">";
  sendLoraSyncReliable(syncMsg);
  Serial.println(">> [TX SYNC -> HMI] Đã đồng bộ chế độ: " + syncMsg);
}

// =================================================================
// HÀM ĐIỀU KHIỂN RELAY
// =================================================================
void turnOn(int index, String sourceCmd) {
  digitalWrite(relayPins[index], HIGH);
  Serial.print("[Lenh: " + sourceCmd + "] -> [BAT] Relay " + String(index + 1));
  Serial.println(" (Chan " + String(relayNames[index]) + ")");

  // Nếu lệnh bấm từ nút cơ tủ điện -> Gửi bản tin đồng bộ SYNC lên HMI
  if (sourceCmd.startsWith("D")) {
    sendLoraSync(index, true);
  }
}

void turnOff(int index, String sourceCmd) {
  digitalWrite(relayPins[index], LOW);
  Serial.print("[Lenh: " + sourceCmd + "] -> [TAT] Relay " + String(index + 1));
  Serial.println(" (Chan " + String(relayNames[index]) + ")");

  // Nếu lệnh bấm từ nút cơ tủ điện -> Gửi bản tin đồng bộ SYNC lên HMI
  if (sourceCmd.startsWith("D")) {
    sendLoraSync(index, false);
  }
}

// =================================================================
// XỬ LÝ LỆNH LORA TỪ ESP32 MASTER / MÀN HÌNH HMI
//
// Có 2 format lệnh relay khác nhau, cố ý tách biệt:
//   <ONx>/<OFFx>         -> lệnh TAY (từ HMI/Web khi systemMode=MANUAL)
//   <AUTOONx>/<AUTOOFFx> -> lệnh do chính state machine AUTO trên ESP32
//                            tự sinh ra khi systemMode=AUTO
// Nano áp khóa an toàn cục bộ đối lập nhau cho 2 loại:
//   - <ONx>/<OFFx>: CHỈ chấp nhận khi Nano đang ở MANUAL
//   - <AUTOONx>/<AUTOOFFx>: CHỈ chấp nhận khi Nano đang ở AUTO
// Nếu bị từ chối, Nano gửi NACK (không phải ACK giả) để ESP32 biết lệnh
// chưa hề được thực thi.
// =================================================================
void processLoraCommand(String cmd) {
  Serial.println(F("\n------------------------------------------------"));
  Serial.println(">> [LORA RX <- ESP32] Nhận lệnh: " + cmd);

  if (cmd == "<ESTOP>") {
    for (int i = 0; i < TOTAL_RELAYS; i++) {
      digitalWrite(relayPins[i], LOW);
    }
    isAutoMode = false; isManualMode = false;
    Serial.println(F(" -> THỰC THI: DỪNG KHẨN CẤP (E-STOP) TOÀN BỘ RELAY!"));
    sendLoraAck(cmd);
    Serial.println(F("------------------------------------------------"));
    return;
  }
  else if (cmd == "<SET_MODE=AUTO>") {
    isAutoMode = true; isManualMode = false;
    turnOn(9, "LORA_AUTO");
  }
  else if (cmd == "<SET_MODE=MANUAL>") {
    isManualMode = true; isAutoMode = false;
    turnOff(9, "LORA_MANUAL");
  }
  else if (cmd.startsWith("<AUTOON") && cmd.endsWith(">")) {
    if (isAutoMode != true) {
      Serial.println(F(" -> [DESYNC] Lệnh AUTO nhưng Nano đang ở MANUAL, từ chối!"));
      sendLoraNack(cmd);
      Serial.println(F("------------------------------------------------"));
      return;
    }
    int relayNum = cmd.substring(7, cmd.length() - 1).toInt();
    if (relayNum >= 1 && relayNum <= TOTAL_RELAYS) {
      turnOn(relayNum - 1, "LORA_AUTO_CMD");
    }
  }
  else if (cmd.startsWith("<AUTOOFF") && cmd.endsWith(">")) {
    if (isAutoMode != true) {
      Serial.println(F(" -> [DESYNC] Lệnh AUTO nhưng Nano đang ở MANUAL, từ chối!"));
      sendLoraNack(cmd);
      Serial.println(F("------------------------------------------------"));
      return;
    }
    int relayNum = cmd.substring(8, cmd.length() - 1).toInt();
    if (relayNum >= 1 && relayNum <= TOTAL_RELAYS) {
      turnOff(relayNum - 1, "LORA_AUTO_CMD");
    }
  }
  else if (cmd.startsWith("<ON") && cmd.endsWith(">")) {
    if (isAutoMode == true) {
      Serial.println(F(" -> [KHÓA AN TOÀN] Đang ở AUTO, từ chối bật tay từ Lora!"));
      sendLoraNack(cmd);
      Serial.println(F("------------------------------------------------"));
      return;
    }
    int relayNum = cmd.substring(3, cmd.length() - 1).toInt();
    if (relayNum >= 1 && relayNum <= TOTAL_RELAYS) {
      turnOn(relayNum - 1, "LORA_HMI");
    }
  }
  else if (cmd.startsWith("<OFF") && cmd.endsWith(">")) {
    if (isAutoMode == true) {
      Serial.println(F(" -> [KHÓA AN TOÀN] Đang ở AUTO, từ chối tắt tay từ Lora!"));
      sendLoraNack(cmd);
      Serial.println(F("------------------------------------------------"));
      return;
    }
    int relayNum = cmd.substring(4, cmd.length() - 1).toInt();
    if (relayNum >= 1 && relayNum <= TOTAL_RELAYS) {
      turnOff(relayNum - 1, "LORA_HMI");
    }
  }
  else {
    Serial.println(F(" -> [CẢNH BÁO] Lệnh LoRa không thuộc danh sách xử lý!"));
  }

  sendLoraAck(cmd);
  Serial.println(F("------------------------------------------------"));
}

// =================================================================
// SETUP
// =================================================================
void setup() {
  Serial.begin(9600);

  for (int i = 0; i < TOTAL_RELAYS; i++) {
    digitalWrite(relayPins[i], LOW);
    pinMode(relayPins[i], OUTPUT);
  }

  pinMode(LORA_AUX, INPUT_PULLUP);

  loraSerial.begin(9600);
  uart.begin(9600);
  uart.listen();

  delay(500);
  Serial.println(F("=================================================="));
  Serial.println(F("--- NANO 2 (SLAVE): SAN SANG NHAN LORA & TU DIEN ---"));
  Serial.println(F("=================================================="));
}

// =================================================================
// MAIN LOOP
// =================================================================
void loop() {
  // 1. ĐỌC NÚT NHẤN TỦ ĐIỆN (UART NANO 1)
  if (uart.isListening() && uart.available()) {
    String s = uart.readStringUntil('\n');
    s.trim();

    if (s.length() == 0) goto checkLora;

    // --- XỬ LÝ GẠT CÔNG TẮC CHẾ ĐỘ + GỬI ĐỒNG BỘ LÊN HMI ---
    if (s == "A0_ON") {
      isAutoMode = true; isManualMode = false;
      Serial.println(F(">>> NANO 2: DA BAT CHE DO AUTO (A0 = ON) <<<"));
      turnOn(9, "TU_DIEN_AUTO");
      sendLoraModeSync(1); // Gửi MODE=1 (Auto) lên ESP32 HMI
    }
    else if (s == "A0_OFF") {
      isAutoMode = false;
      Serial.println(F(">>> NANO 2: DA TAT CHE DO AUTO (A0 = OFF) <<<"));
      turnOff(9, "TU_DIEN_STOP");
      sendLoraModeSync(-1); // Gửi MODE=-1 (Stop) lên ESP32 HMI
    }
    else if (s == "A1_ON") {
      isManualMode = true; isAutoMode = false;
      Serial.println(F(">>> NANO 2: DA BAT CHE DO MANUAL (A1 = ON) <<<"));
      turnOff(9, "TU_DIEN_MANUAL");
      sendLoraModeSync(0); // Gửi MODE=0 (Manual) lên ESP32 HMI
    }
    else if (s == "A1_OFF") {
      isManualMode = false;
      Serial.println(F(">>> NANO 2: DA TAT CHE DO MANUAL (A1 = OFF) <<<"));
      sendLoraModeSync(-1); // Gửi MODE=-1 (Stop) lên ESP32 HMI
    }
    else if (isAutoMode == false) {
      if      (s == "D2")  turnOn(0, s);  else if (s == "D7")  turnOff(0, s);
      else if (s == "D3")  turnOn(1, s);  else if (s == "D8")  turnOff(1, s);
      else if (s == "D4")  turnOn(2, s);  else if (s == "D9")  turnOff(2, s);
      else if (s == "D5")  turnOn(3, s);  else if (s == "D10") turnOff(3, s);
      else if (s == "D6")  turnOn(4, s);  else if (s == "D11") turnOff(4, s);
      else if (s == "D12_ON") turnOn(5, s);  else if (s == "D12_OFF") turnOff(5, s);
      else if (s == "D13_ON") turnOn(6, s);  else if (s == "D13_OFF") turnOff(6, s);
      else if (s == "D14_ON") turnOn(7, s);  else if (s == "D14_OFF") turnOff(7, s);
      else if (s == "D15_ON") turnOn(8, s);  else if (s == "D15_OFF") turnOff(8, s);
      else { 
        Serial.print(F("  -> [LOI] Lenh khong hop le: ")); Serial.println(s);
      }
    }
    else {
      Serial.print(F("  -> [KHOA AN TOAN] Tu choi nut tay do dang o AUTO: "));
      Serial.println(s);
    }
  }

  // 2. ĐỌC LORA TỪ ESP32 MASTER
  checkLora:
  if (digitalRead(LORA_AUX) == LOW) {
    uart.stopListening();
    loraSerial.listen();
    delay(5);

    unsigned long start = millis();
    while (millis() - start < 100) {
      if (loraSerial.available()) {
        char c = loraSerial.read();
        if (c == '\n') {
          loraBuffer.trim();
          if (loraBuffer.startsWith("<") && loraBuffer.endsWith(">")) {
            processLoraCommand(loraBuffer);
          }
          loraBuffer = "";
          break;
        } else if (c != '\r' && loraBuffer.length() < 128) {
          loraBuffer += c;
        }
      }
    }
    loraSerial.stopListening();
    uart.listen();
  }
}






