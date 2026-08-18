/**
 * ============================================================================
 * STM32F411 SENSOR NODE - POLL-RESPONSE MODE (chỉ gửi khi ESP32 hỏi)
 * ============================================================================
 * Thay đổi so với bản tự phát định kỳ:
 * - Bỏ hẳn timer tự gửi <DATA:...> mỗi 2 giây.
 * - Lắng nghe lệnh <REQ_DATA> từ ESP32, chỉ gửi khi được hỏi.
 * - Nút PB2 (ép đo) giờ chỉ cập nhật LCD tại chỗ, KHÔNG tự phát LoRa nữa,
 *   để tránh chen ngang kênh RF chung với giao tiếp ESP32<->Nano.
 * ============================================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>  

// ===================== LCD I2C =====================
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ===================== RS485 MODBUS (UART1) =====================
// Doi ten khoi Serial1: core STM32duino DA tu dinh nghia bien Serial1 khi
// ENABLE_HWSERIAL1 bat, nen khai bao them mot Serial1 nua lam trinh lien ket
// bao "multiple definition of Serial1" va khong build duoc. Chi doi TEN BIEN;
// van la UART1 tren dung hai chan PA10/PA9, moi cho khac dung RS485_Serial
// nen khong phai sua gi them.
HardwareSerial rs485Port(PA10, PA9);
#define RS485_Serial rs485Port
const uint8_t SENSOR_ID = 0x02; 

// ===================== LORA E32 (UART2) =====================
HardwareSerial loraSerial(PA3, PA2);
#define LORA_M0  PA5
#define LORA_M1  PA6
// Nếu board bạn có nối chân AUX của E32, khai báo thêm và dùng như Nano/ESP32:
// #define LORA_AUX PA4 
// pinMode(LORA_AUX, INPUT); và while(digitalRead(LORA_AUX)==LOW) delay(2); trước khi TX

// ===================== CHÂN NÚT NHẤN =====================
#define BTN1_PIN PB5
#define BTN2_PIN PB7

// ===================== CHÂN SIÊU ÂM =====================
#define TRIG_PIN  PB12
#define ECHO1_PIN PB13
#define ECHO2_PIN PB14
#define ECHO3_PIN PB15
#define ECHO4_PIN PA8

// ===================== CHÂN DHT =====================
#define DHT_PIN  PA0      
#define DHT_TYPE DHT22    
DHT dht(DHT_PIN, DHT_TYPE);

// ===================== CHÂN ADC MƯA =====================
#define RAIN_SENSOR_PIN PA1 

// =================================================================
// STRUCT LƯU TRỮ DỮ LIỆU CẢM BIẾN
// =================================================================
struct SensorData {
  float Temperature;
  float Humidity;
  uint16_t EC_Value;
  float pH_Value;
  uint16_t Nitrogen;
  uint16_t Phosphorus;
  uint16_t Potassium;

  unsigned long lastModbusReadTime;
  bool isModbusValid;
  uint8_t modbusErrorCount;

  float AirTemp;
  float AirHum;
  unsigned long lastDHTReadTime;
  bool isDHTValid;
  uint8_t dhtErrorCount;

  int RainRawADC;
  int RainPercent;
  unsigned long lastRainReadTime;
  bool isRainValid;

  float Dist1, Dist2, Dist3, Dist4;
  unsigned long lastUltrasonicReadTime;
  bool isUltrasonicValid;
};

SensorData sensorData = {0};

// =================================================================
// ADC SMOOTHING FILTER CLASS
// =================================================================
class ADCFilter {
private:
  static const int WINDOW_SIZE = 5;
  int buffer[WINDOW_SIZE];
  int index;
  int sum;
public:
  ADCFilter() : index(0), sum(0) {
    for (int i = 0; i < WINDOW_SIZE; i++) buffer[i] = 0;
  }
  int addSample(int value) {
    sum -= buffer[index];
    buffer[index] = value;
    sum += value;
    index = (index + 1) % WINDOW_SIZE;
    return sum / WINDOW_SIZE;  
  }
};
ADCFilter rainFilter;  

const int RAIN_DRY_THRESHOLD = 3700;    
const int RAIN_WET_THRESHOLD = 1200;    
const int RAIN_ADC_MAX = 4095;          
const int RAIN_ADC_MIN = 0;             

int mapADCToRainPercent(int rawADC) {
  rawADC = constrain(rawADC, RAIN_ADC_MIN, RAIN_ADC_MAX);
  return map(rawADC, RAIN_ADC_MAX, RAIN_ADC_MIN, 0, 100);
}

uint8_t lcdPage = 0;
unsigned long lastBtn1Debounce = 0;
unsigned long lastBtn2Debounce = 0;
const unsigned long DEBOUNCE_DELAY = 30;

bool lastBtn1State = HIGH;
bool lastBtn2State = HIGH;

// LoRa RX buffer cho lệnh REQ_DATA từ ESP32
String loraRxBuffer = "";

void setLoraNormalMode() {
  digitalWrite(LORA_M0, LOW);
  digitalWrite(LORA_M1, LOW);
  delay(10);
}

// =================================================================
// HÀM ĐỌC DHT
// =================================================================
void readDHT22Sensor() {
  unsigned long now = millis();
  if (now - sensorData.lastDHTReadTime < 2500) return; 
  
  float temp = dht.readTemperature();      
  float humidity = dht.readHumidity();     
  
  if (isnan(temp) || isnan(humidity)) {
    sensorData.dhtErrorCount++;
    sensorData.isDHTValid = false;
    
    if (sensorData.dhtErrorCount > 3) {
      sensorData.AirTemp = -1.0;
      sensorData.AirHum = -1.0;
      dht.begin(); 
    }
  } else {
    sensorData.AirTemp = temp;
    sensorData.AirHum = humidity;
    sensorData.isDHTValid = true;
    sensorData.dhtErrorCount = 0; 
  }
  sensorData.lastDHTReadTime = now;
}

// =================================================================
// HÀM ĐỌC MƯA
// =================================================================
void readRainSensor() {
  unsigned long now = millis();
  int rawADC = analogRead(RAIN_SENSOR_PIN);
  int smoothedADC = rainFilter.addSample(rawADC);
  sensorData.RainPercent = mapADCToRainPercent(smoothedADC);
  sensorData.RainRawADC = smoothedADC;
  sensorData.isRainValid = true;
  sensorData.lastRainReadTime = now;
}

// =================================================================
// HÀM ĐỌC SIÊU ÂM
// =================================================================
float readUltrasonic(uint32_t echoPin) {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long duration = pulseIn(echoPin, HIGH, 25000);
  if (duration == 0) return -1.0;  
  return (duration * 0.0343) / 2.0;  
}

void readAllUltrasonic() {
  unsigned long now = millis();
  sensorData.Dist1 = readUltrasonic(ECHO1_PIN); delay(5);
  sensorData.Dist2 = readUltrasonic(ECHO2_PIN); delay(5);
  sensorData.Dist3 = readUltrasonic(ECHO3_PIN); delay(5);
  float rawD4 = readUltrasonic(ECHO4_PIN);
  sensorData.Dist4 = (rawD4 > 0) ? (rawD4 + 13.0) : -1.0;  
  
  sensorData.isUltrasonicValid = (sensorData.Dist1 > 0) && (sensorData.Dist2 > 0) && 
                                 (sensorData.Dist3 > 0) && (sensorData.Dist4 > 0);
  sensorData.lastUltrasonicReadTime = now;
}

// =================================================================
// HÀM ĐỌC MODBUS 7-IN-1
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
  unsigned long now = millis();
  while (RS485_Serial.available()) { RS485_Serial.read(); }
  
  uint8_t txData[8] = {SENSOR_ID, 0x03, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00};
  uint16_t crc = Modbus_CRC16(txData, 6);
  txData[6] = crc & 0xFF;
  txData[7] = (crc >> 8) & 0xFF;
  
  RS485_Serial.write(txData, 8);
  RS485_Serial.flush();
  delay(10);
  
  uint8_t rxData[19];
  int byteCount = 0;
  unsigned long startTime = millis();
  
  while ((millis() - startTime < 500) && (byteCount < 19)) {
    if (RS485_Serial.available() > 0) {
      rxData[byteCount++] = RS485_Serial.read();
      startTime = millis(); 
    }
  }
  
  if (byteCount == 19 && rxData[0] == SENSOR_ID && rxData[1] == 0x03 && rxData[2] == 14) {
    uint16_t received_crc = (rxData[18] << 8) | rxData[17];
    
    if (received_crc == Modbus_CRC16(rxData, 17)) {
      sensorData.Humidity    = ((rxData[3] << 8) | rxData[4]) / 10.0;
      sensorData.Temperature = ((rxData[5] << 8) | rxData[6]) / 10.0;
      sensorData.EC_Value    = (rxData[7] << 8) | rxData[8];
      sensorData.pH_Value    = ((rxData[9] << 8) | rxData[10]) / 10.0;  
      sensorData.Nitrogen    = (rxData[11] << 8) | rxData[12];
      sensorData.Phosphorus  = (rxData[13] << 8) | rxData[14];
      sensorData.Potassium   = (rxData[15] << 8) | rxData[16];
      
      sensorData.isModbusValid = true;
      sensorData.modbusErrorCount = 0;
    } else {
      sensorData.modbusErrorCount++;
      sensorData.isModbusValid = false;
    }
  } else {
    sensorData.modbusErrorCount++;
    sensorData.isModbusValid = false;
  }

  if (sensorData.modbusErrorCount > 5) {
    sensorData.Temperature = -1.0;
    sensorData.Humidity = -1.0;
    sensorData.pH_Value = -1.0;
    sensorData.EC_Value = 0;
    sensorData.Nitrogen = 0;
    sensorData.Phosphorus = 0;
    sensorData.Potassium = 0;
  }
}

// =================================================================
// LORA TX - CHỈ GỌI KHI NHẬN ĐƯỢC <REQ_DATA> TỪ ESP32
// =================================================================
void sendLoraSensorData() {
  setLoraNormalMode();
  
  String payload = "<DATA:" +
                   String(sensorData.Temperature, 1) + "," +
                   String(sensorData.Humidity, 1) + "," +
                   String(sensorData.EC_Value) + "," +
                   String(sensorData.pH_Value, 1) + "," +
                   String(sensorData.Nitrogen) + "," +
                   String(sensorData.Phosphorus) + "," +
                   String(sensorData.Potassium) + "," +
                   String(sensorData.Dist1, 1) + "," +
                   String(sensorData.Dist2, 1) + "," +
                   String(sensorData.Dist3, 1) + "," +
                   String(sensorData.Dist4, 1) + "," +
                   String(sensorData.RainPercent) + "," +
                   String(sensorData.AirTemp, 1) + "," +
                   String(sensorData.AirHum, 1) + ">";
  
  delay(10);
  loraSerial.println(payload);
  delay(20);
  Serial.println(">> [LORA TX -> ESP32] Trả lời REQ_DATA: " + payload);
}

// =================================================================
// LẮNG NGHE LỆNH TỪ ESP32 (CHỈ CÓ <REQ_DATA>)
// =================================================================
void handleLoraIncoming() {
  while (loraSerial.available()) {
    char c = loraSerial.read();
    if (c == '\n') {
      loraRxBuffer.trim();
      if (loraRxBuffer == "<REQ_DATA>") {
        Serial.println("  [LORA RX] Nhan REQ_DATA -> gui du lieu");
        sendLoraSensorData();
      }
      loraRxBuffer = "";
    } else if (c != '\r' && loraRxBuffer.length() < 64) {
      loraRxBuffer += c;
    }
  }
}

// =================================================================
// HÀM HIỂN THỊ LCD
// =================================================================
void renderLCD() {
  static uint8_t lastPage = 255;
  if (lcdPage != lastPage) {
    lcd.clear();
    lastPage = lcdPage;
  }

  if (lcdPage == 0) {
    lcd.setCursor(0, 0); 
    lcd.print("T:"); lcd.print(sensorData.Temperature, 1); lcd.print("C ");
    lcd.print("H:"); lcd.print(sensorData.Humidity, 1); lcd.print("%   ");
    lcd.setCursor(0, 1); 
    lcd.print("EC:"); lcd.print(sensorData.EC_Value); lcd.print(" ");
    lcd.print("pH:"); lcd.print(sensorData.pH_Value, 1); lcd.print("    ");
  }
  else if (lcdPage == 1) {
    lcd.setCursor(0, 0); 
    lcd.print("Dinh duong (NPK) ");
    lcd.setCursor(0, 1); 
    lcd.print("N:"); lcd.print(sensorData.Nitrogen); 
    lcd.print(" P:"); lcd.print(sensorData.Phosphorus); 
    lcd.print(" K:"); lcd.print(sensorData.Potassium);
    lcd.print("   ");
  }
  else if (lcdPage == 2) {
    lcd.setCursor(0, 0); 
    lcd.print("A:"); lcd.print(sensorData.AirTemp, 1); lcd.print("C  ");
    lcd.print("R:"); lcd.print(sensorData.RainPercent); lcd.print("%   ");
    lcd.setCursor(0, 1); 
    lcd.print("H:"); lcd.print(sensorData.AirHum, 1); lcd.print("% ");
    lcd.print("A:"); lcd.print(sensorData.RainRawADC); lcd.print("   ");
  }
  else {
    lcd.setCursor(0, 0); 
    lcd.print("K:"); lcd.print((int)sensorData.Dist3); lcd.print("cm ");
    lcd.print("W:"); lcd.print((int)sensorData.Dist4); lcd.print("cm  ");
    lcd.setCursor(0, 1); 
    lcd.print("D1:"); lcd.print((int)sensorData.Dist1); lcd.print("cm ");
    lcd.print("D2:"); lcd.print((int)sensorData.Dist2); lcd.print("cm  ");
  }
}

void handleButtons() {
  unsigned long currentMillis = millis();
  
  bool readingBtn1 = digitalRead(BTN1_PIN);
  if (readingBtn1 != lastBtn1State) { lastBtn1Debounce = currentMillis; }
  if ((currentMillis - lastBtn1Debounce) > DEBOUNCE_DELAY) {
    static bool btn1ProcessedState = HIGH;
    if (readingBtn1 != btn1ProcessedState) {
      btn1ProcessedState = readingBtn1;
      if (btn1ProcessedState == LOW) { lcdPage = (lcdPage + 1) % 4; renderLCD(); }
    }
  }
  lastBtn1State = readingBtn1;
  
  // Nút PB7 giờ chỉ ép đo tại chỗ cho LCD, KHÔNG tự gửi LoRa nữa
  // (tránh phát sóng ngoài dự kiến gây tranh chấp kênh)
  bool readingBtn2 = digitalRead(BTN2_PIN);
  if (readingBtn2 != lastBtn2State) { lastBtn2Debounce = currentMillis; }
  if ((currentMillis - lastBtn2Debounce) > DEBOUNCE_DELAY) {
    static bool btn2ProcessedState = HIGH;
    if (readingBtn2 != btn2ProcessedState) {
      btn2ProcessedState = readingBtn2;
      if (btn2ProcessedState == LOW) {
        readModbusSensor();
        readDHT22Sensor();
        readRainSensor();
        readAllUltrasonic();
        renderLCD();
        Serial.println(">> [PB2] Ep do tai cho (khong gui LoRa)");
      }
    }
  }
  lastBtn2State = readingBtn2;
}

// =================================================================
// SETUP & LOOP
// =================================================================
void setup() {
  Serial.begin(115200);
  
  analogReadResolution(12);
  
  pinMode(BTN1_PIN, INPUT); pinMode(BTN2_PIN, INPUT);
  pinMode(TRIG_PIN, OUTPUT); digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO1_PIN, INPUT); pinMode(ECHO2_PIN, INPUT);
  pinMode(ECHO3_PIN, INPUT); pinMode(ECHO4_PIN, INPUT);
  
  pinMode(LORA_M0, OUTPUT); pinMode(LORA_M1, OUTPUT);
  setLoraNormalMode();
  
  Wire.setSDA(PB9); Wire.setSCL(PB8); Wire.begin();
  lcd.init(); lcd.backlight();
  lcd.setCursor(0, 0); lcd.print("Khoi dong he...");
  
  RS485_Serial.begin(9600, SERIAL_8N1);
  loraSerial.begin(9600, SERIAL_8N1);
  dht.begin();
  
  delay(1000); lcd.clear();
  Serial.println("--- STM32 SLAVE: CHE DO POLL-RESPONSE, CHO REQ_DATA ---");
}

void loop() {
  readModbusSensor();      
  readDHT22Sensor();       
  readRainSensor();        
  readAllUltrasonic();     
  
  renderLCD();
  handleLoraIncoming();   // lắng nghe REQ_DATA liên tục, không chặn (non-blocking)
  
  unsigned long waitStart = millis();
  while (millis() - waitStart < 500) {
    handleButtons();
    handleLoraIncoming();   // vẫn lắng nghe trong lúc chờ, để không trễ trả lời REQ_DATA
  }
}






