#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ===================== CHỌN CHẾ ĐỘ HOẠT ĐỘNG =====================
// 0 = Đọc CẢM BIẾN THẬT 100% (RS485 Modbus NPK + 4 Cảm biến Siêu âm)
// 1 = Phát dữ liệu ảo test HMI
#define USE_DUMMY_DATA 0

LiquidCrystal_I2C lcd(0x27, 16, 2); 

// 1. CỔNG RS485 MODBUS CẢM BIẾN ĐẤT (UART1)
HardwareSerial Serial1(PA10, PA9); // RX = PA10, TX = PA9
#define RS485_Serial Serial1 

// 2. CỔNG LORA E32 (UART2 - KẾT NỐI ESP32 MASTER)
// PA3 nối TXD của LoRa | PA2 nối RXD của LoRa
HardwareSerial loraSerial(PA3, PA2); 
#define LORA_M0  PA5  // Nối M0 của LoRa
#define LORA_M1  PA6  // Nối M1 của LoRa

// --- KHAI BÁO CHÂN NÚT NHẤN ---
#define BTN1_PIN PB5  // SW1: Đổi trang hiển thị LCD (3 trang)
#define BTN2_PIN PB7  // SW2: Ép đo cảm biến và gửi LoRa ngay lập tức

// --- KHAI BÁO CHÂN 4 CẢM BIẾN SIÊU ÂM (TRIG CHUNG) ---
#define TRIG_PIN  PB12
#define ECHO1_PIN PB13 // Cảm biến 1
#define ECHO2_PIN PB14 // Cảm biến 2
#define ECHO3_PIN PB15 // Cảm biến 3 (Bồn Kali)
#define ECHO4_PIN PA8  // Cảm biến 4 (Bồn Nước)

// --- BIẾN LƯU TRỮ DỮ LIỆU CẢM BIẾN THẬT ---
float Temperature = 0.0;
float Humidity    = 0.0;
uint16_t EC_Value = 0;
float pH_Value    = 0.0;
uint16_t Nitrogen   = 0;
uint16_t Phosphorus = 0;
uint16_t Potassium  = 0;

// Khoảng cách 4 bồn (cm)
float Dist1 = 0.0;
float Dist2 = 0.0;
float Dist3 = 0.0; // Bồn Kali
float Dist4 = 0.0; // Bồn Nước (Đã hiệu chuẩn +13cm)
// --- BIẾN LƯU TRỮ MÔI TRƯỜNG KHÔNG KHÍ & MƯA ---
float AirTemp     = 0.0;
int   RainPercent = 0;
float AirHum      = 0.0;
// Biến quản lý trạng thái nút nhấn & thời gian gửi LoRa
uint8_t lcdPage = 0;          
bool forceSendNext = false;   
unsigned long lastBtn1Debounce = 0; 
unsigned long lastBtn2Debounce = 0;
unsigned long lastLoraSendTime = 0;

// =================================================================
// ---> CẬP NHẬT: GỬI LORA MỖI 2 PHÚT (120 giây = 120,000 mili-giây)
// =================================================================
const unsigned long LORA_SEND_INTERVAL = 120000UL; 

const unsigned long DEBOUNCE_DELAY = 30;

bool lastBtn1State = HIGH;
bool lastBtn2State = HIGH;

// =================================================================
// HÀM CẤU HÌNH LORA NORMAL MODE (M0 = 0, M1 = 0)
// =================================================================
void setLoraNormalMode() {
  digitalWrite(LORA_M0, LOW);
  digitalWrite(LORA_M1, LOW);
  delay(10);
}

// =================================================================
// HÀM GỬI LORA LÊN ESP32 -> HIỂN THỊ MÀN HÌNH HMI NEXTION
// =================================================================
void sendLoraSensorData() {
  setLoraNormalMode();

  // Đóng gói đúng định dạng 11 biến mà ESP32 Master chờ nhận:
  // <DATA:Temp,Hum,EC,pH,N,P,K,D1,D2,D3,D4>
  // Đóng gói đúng định dạng 14 biến thật mà ESP32 Master chờ nhận:
  String payload = "<DATA:" + 
                   String(Temperature, 1) + "," + 
                   String(Humidity, 1)    + "," + 
                   String(EC_Value)       + "," + 
                   String(pH_Value, 1)    + "," + 
                   String(Nitrogen)       + "," + 
                   String(Phosphorus)     + "," + 
                   String(Potassium)      + "," + 
                   String(Dist1, 1)       + "," + 
                   String(Dist2, 1)       + "," + 
                   String(Dist3, 1)       + "," + 
                   String(Dist4, 1)       + "," + 
                   String(RainPercent)    + "," + 
                   String(AirTemp, 1)     + "," + 
                   String(AirHum, 1)      + ">";

  delay(10);
  loraSerial.println(payload);
  delay(20); // Nhịp nghỉ giúp module LoRa phát toàn bộ sóng vô tuyến đi

  lastLoraSendTime = millis();
  Serial.println(">> [LORA TX -> ESP32 HMI] Đã gửi thông số cảm biến thật: " + payload);
}

// =================================================================
// HÀM ĐỌC CẢM BIẾN SIÊU ÂM
// =================================================================
float readUltrasonic(uint32_t echoPin) {
  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long duration = pulseIn(echoPin, HIGH, 25000);
  if (duration == 0) return -1.0; 
  return (duration * 0.0343) / 2.0;
}

void readAllUltrasonic() {
  Dist1 = readUltrasonic(ECHO1_PIN); delay(10); 
  Dist2 = readUltrasonic(ECHO2_PIN); delay(10);
  Dist3 = readUltrasonic(ECHO3_PIN); delay(10);
  
  // Đọc bồn nước (D4) và bù độ lệch +13cm theo hiệu chuẩn sa bàn thực tế
  float rawD4 = readUltrasonic(ECHO4_PIN);
  Dist4 = (rawD4 > 0) ? (rawD4 + 13.0) : -1.0; 
}
// =================================================================
// HÀM ĐỌC CẢM BIẾN KHÍ HẬU
// =================================================================
void readAirSensors() {
  // Khoa hãy thay thế các dòng gán số này bằng lệnh đọc cảm biến thực tế của bạn 
  // (Ví dụ: dht.readTemperature(), analogRead(RAIN_PIN),...)
  
  AirTemp = 32.5;     // Gắn hàm đọc nhiệt độ không khí vào đây
  AirHum = 70.0;      // Gắn hàm đọc độ ẩm không khí vào đây
  RainPercent = 15;   // Gắn thuật toán tính % mưa (map analog) vào đây
}
// =================================================================
// HÀM ĐỌC CẢM BIẾN ĐẤT MODBUS RS485 (NHIỆT, ẨM, EC, PH, N, P, K)
// =================================================================
uint16_t Modbus_CRC16(const uint8_t *buf, uint8_t len) {
  uint16_t crc = 0xFFFF;
  for (int pos = 0; pos < len; pos++) {
    crc ^= (uint16_t)buf[pos];
    for (int i = 8; i != 0; i--) {
      if ((crc & 0x0001) != 0) { crc >>= 1; crc ^= 0xA001; }
      else { crc >>= 1; }
    }
  }
  return crc;
}

void readModbusSensor() {
  while (RS485_Serial.available()) { RS485_Serial.read(); }

  uint8_t txData[8] = {0x02, 0x03, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00};
  uint16_t crc = Modbus_CRC16(txData, 6);
  txData[6] = crc & 0xFF;        
  txData[7] = (crc >> 8) & 0xFF; 

  RS485_Serial.write(txData, 8);
  RS485_Serial.flush(); 
  delay(5); 

  uint8_t rxData[19]; 
  int byteCount = 0;
  unsigned long startTime = millis();
  
  while ((millis() - startTime < 400) && (byteCount < 19)) {
    if (RS485_Serial.available() > 0) { 
      rxData[byteCount++] = RS485_Serial.read(); 
      startTime = millis(); 
    }
  }

  if (byteCount == 19 && rxData[0] == 0x02 && rxData[1] == 0x03 && rxData[2] == 14) {
    uint16_t received_crc = (rxData[18] << 8) | rxData[17];
    if (received_crc == Modbus_CRC16(rxData, 17)) {
      Humidity    = ((rxData[3]  << 8) | rxData[4])  / 10.0; // % RH
      Temperature = ((rxData[5]  << 8) | rxData[6])  / 10.0; // °C
      EC_Value    =  (rxData[7]  << 8) | rxData[8];          // uS/cm
      pH_Value    = ((rxData[9]  << 8) | rxData[10]) / 10.0; // pH
      Nitrogen    =  (rxData[11] << 8) | rxData[12];         // N (mg/kg)
      Phosphorus  =  (rxData[13] << 8) | rxData[14];         // P (mg/kg)
      Potassium   =  (rxData[15] << 8) | rxData[16];         // K (mg/kg)
    } else {
      Serial.println("[Cảnh báo] Sai mã CRC từ cảm biến RS485 Modbus!");
    }
  } else {
    Serial.println("[Cảnh báo] Không nhận được phản hồi hợp lệ từ cảm biến NPK!");
  }
}

// =================================================================
// HÀM HIỂN THỊ MÀN HÌNH LCD 1602 TẠI TRẠM
// =================================================================
void renderLCD() {
  char lineBuffer[17]; 
  if (lcdPage == 0) {
    lcd.setCursor(0, 0);
    lcd.print("T:"); lcd.print(Temperature, 1); lcd.print("C H:");
    lcd.print(Humidity, 1);                         lcd.print("%   ");
    lcd.setCursor(0, 1);
    lcd.print("EC:"); lcd.print(EC_Value);      lcd.print(" pH:");
    lcd.print(pH_Value, 1);                         lcd.print("    ");
  } 
  else if (lcdPage == 1) {
    lcd.setCursor(0, 0); lcd.print("Dinh duong (NPK)");
    lcd.setCursor(0, 1);
    lcd.print("N:"); lcd.print(Nitrogen); 
    lcd.print(" P:"); lcd.print(Phosphorus); 
    lcd.print(" K:"); lcd.print(Potassium); 
    lcd.print("   ");
  } 
  else {
    lcd.setCursor(0, 0);
    sprintf(lineBuffer, "K:%dcm W:%dcm   ", (int)Dist3, (int)Dist4);
    lcd.print(lineBuffer);
    lcd.setCursor(0, 1);
    sprintf(lineBuffer, "D1:%dcm D2:%dcm  ", (int)Dist1, (int)Dist2);
    lcd.print(lineBuffer);
  }
}

// =================================================================
// HÀM XỬ LÝ NÚT NHẤN
// =================================================================
void handleButtons() {
  unsigned long currentMillis = millis();

  // NÚT PB5: Chuyển 3 trang LCD
  bool readingBtn1 = digitalRead(BTN1_PIN);
  if (readingBtn1 != lastBtn1State) { lastBtn1Debounce = currentMillis; }
  if ((currentMillis - lastBtn1Debounce) > DEBOUNCE_DELAY) {
    static bool btn1ProcessedState = HIGH;
    if (readingBtn1 != btn1ProcessedState) {
      btn1ProcessedState = readingBtn1;
      if (btn1ProcessedState == LOW) { 
        lcdPage = (lcdPage + 1) % 3; 
        renderLCD(); 
      }
    }
  }
  lastBtn1State = readingBtn1;

  // NÚT PB7: Ép đo cảm biến & gửi LoRa lên HMI ngay lập tức (không chờ hết 2 phút)
  bool readingBtn2 = digitalRead(BTN2_PIN);
  if (readingBtn2 != lastBtn2State) { lastBtn2Debounce = currentMillis; }
  if ((currentMillis - lastBtn2Debounce) > DEBOUNCE_DELAY) {
    static bool btn2ProcessedState = HIGH;
    if (readingBtn2 != btn2ProcessedState) {
      btn2ProcessedState = readingBtn2;
      if (btn2ProcessedState == LOW) { 
        forceSendNext = true;        
        Serial.println(">> [PB7] Nhấn nút: Đang đo nhanh và gửi tín hiệu LoRa...");
      }
    }
  }
  lastBtn2State = readingBtn2;
}

// =================================================================
// SETUP
// =================================================================
void setup() {
  Serial.begin(115200);
  
  pinMode(BTN1_PIN, INPUT);
  pinMode(BTN2_PIN, INPUT);
  
  pinMode(TRIG_PIN, OUTPUT); digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO1_PIN, INPUT);
  pinMode(ECHO2_PIN, INPUT);
  pinMode(ECHO3_PIN, INPUT);
  pinMode(ECHO4_PIN, INPUT);

  // --- CẤU HÌNH OUTPUT CHÂN M0 VÀ M1 ---
  pinMode(LORA_M0, OUTPUT);
  pinMode(LORA_M1, OUTPUT);
  setLoraNormalMode();
  
  // I2C LCD cho STM32F411 (SDA: PB9, SCL: PB8)
  Wire.setSDA(PB9);
  Wire.setSCL(PB8);
  Wire.begin(); 
  
  lcd.init();       
  lcd.backlight();  
  
  lcd.setCursor(0, 0); lcd.print("Khoi dong he...");
  lcd.setCursor(0, 1); lcd.print("STM32 Modbus NPK");
  delay(1500); 
  
  Serial.println("==================================================");
  Serial.println("--- STM32F411 (SLAVE 1): CHU KỲ GỬI LORA 2 PHÚT ---");
  Serial.println("==================================================");

  // Khởi tạo UART1 đọc RS485 Modbus & UART2 nối LoRa
  RS485_Serial.begin(9600, SERIAL_8N1);
  loraSerial.begin(9600, SERIAL_8N1);
  delay(500);
  
  lcd.clear();
}

// =================================================================
// MAIN LOOP
// =================================================================
void loop() {
  // 1. Đọc thực tế cảm biến đất Modbus RS485 và 4 cảm biến siêu âm
  readModbusSensor();
  readAllUltrasonic();
  readAirSensors();
  // 2. Cập nhật thông số thực tế lên LCD tại trạm
  renderLCD();

  // 3. Gửi LoRa về ESP32 mỗi 2 phút (hoặc bấm PB7 để gửi ngay lập tức)
  if (forceSendNext || (millis() - lastLoraSendTime >= LORA_SEND_INTERVAL)) {
    forceSendNext = false;
    sendLoraSensorData(); 
  }

  // 4. Vòng chờ 1 giây có quét nút nhấn mượt mà
  unsigned long waitStart = millis();
  while (millis() - waitStart < 1000) {
    handleButtons(); 
    if (forceSendNext) break; 
  }
}