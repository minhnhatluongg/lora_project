/**
 * ============================================================================
 * STM32F411 SENSOR NODE - OPTIMIZED FOR CORTEX-M4 (NON-BLOCKING)
 * ============================================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>  

LiquidCrystal_I2C lcd(0x27, 16, 2);

// Doi ten khoi Serial1: core STM32duino DA tu dinh nghia bien Serial1 khi
// ENABLE_HWSERIAL1 bat, nen khai bao them mot Serial1 nua lam trinh lien ket
// bao "multiple definition of Serial1" va khong build duoc. Chi doi TEN BIEN;
// van la UART1 tren dung hai chan PA10/PA9, moi cho khac dung RS485_Serial.
HardwareSerial rs485Port(PA10, PA9);
#define RS485_Serial rs485Port
const uint8_t SENSOR_ID = 0x02; 

HardwareSerial loraSerial(PA3, PA2);
#define LORA_M0  PA5
#define LORA_M1  PA6

#define BTN1_PIN PB5
#define BTN2_PIN PB7

#define TRIG_PIN  PB12
#define ECHO1_PIN PB13
#define ECHO2_PIN PB14
#define ECHO3_PIN PB15
#define ECHO4_PIN PA8

#define DHT_PIN  PA0     
#define DHT_TYPE DHT22    
DHT dht(DHT_PIN, DHT_TYPE);

#define RAIN_SENSOR_PIN PA1

struct SensorData {
  float Temperature; float Humidity;
  float EC_Value; float pH_Value; // EC_Value đã đổi sang float
  uint16_t Nitrogen; uint16_t Phosphorus; uint16_t Potassium;
  unsigned long lastModbusReadTime; bool isModbusValid; uint8_t modbusErrorCount;

  float AirTemp; float AirHum;
  unsigned long lastDHTReadTime; bool isDHTValid; uint8_t dhtErrorCount;

  int RainRawADC; int RainPercent;
  unsigned long lastRainReadTime; bool isRainValid;

  float Dist1, Dist2, Dist3, Dist4;
  unsigned long lastUltrasonicReadTime; bool isUltrasonicValid;
};

SensorData sensorData = {0};

class EWMAFilter {
private:
  float alpha; float filteredValue; bool isInitialized;
public:
  EWMAFilter(float alphaValue = 0.15) : alpha(alphaValue), isInitialized(false) {}
  int addSample(int rawValue) {
    if (!isInitialized) { filteredValue = rawValue; isInitialized = true; } 
    else { filteredValue = (alpha * rawValue) + ((1.0 - alpha) * filteredValue); }
    return (int)filteredValue;
  }
};
EWMAFilter rainFilter(0.15);  

// Class Filter hỗ trợ số thực (float) cho Nhiệt độ, Độ ẩm, pH, EC
class EWMAFilterFloat {
private:
  float alpha; float filteredValue; bool isInitialized;
public:
  EWMAFilterFloat(float alphaValue = 0.15) : alpha(alphaValue), isInitialized(false) {}
  float addSample(float rawValue) {
    if (!isInitialized) { filteredValue = rawValue; isInitialized = true; } 
    else { filteredValue = (alpha * rawValue) + ((1.0 - alpha) * filteredValue); }
    return filteredValue;
  }
};

// Khởi tạo các bộ lọc 
EWMAFilterFloat humFilter(0.2);
EWMAFilterFloat tempFilter(0.2);
EWMAFilterFloat phFilter(0.2);
EWMAFilterFloat ecFilter(0.2); // EC dùng màng lọc float
EWMAFilter nFilter(0.2);
EWMAFilter pFilter(0.2);
EWMAFilter kFilter(0.2);

const int RAIN_DRY_THRESHOLD = 0;       
const int RAIN_WET_THRESHOLD = 3700;    

int mapADCToRainPercent(int rawADC) {
  rawADC = constrain(rawADC, RAIN_DRY_THRESHOLD, RAIN_WET_THRESHOLD);
  return map(rawADC, RAIN_DRY_THRESHOLD, RAIN_WET_THRESHOLD, 0, 100);
}

uint8_t lcdPage = 0;
unsigned long lastBtn1Debounce = 0; unsigned long lastBtn2Debounce = 0;
const unsigned long DEBOUNCE_DELAY = 30;

String loraRxBuffer = "";
bool debugForceSend = false; 

bool lastBtn1State = HIGH; bool lastBtn2State = HIGH;

bool isSendingLora = false;
unsigned long loraTxTimer = 0;
String loraPendingPayload = "";

String sysMessage = "";
unsigned long sysMessageTime = 0;
bool isShowingMsg = false;

void setLoraNormalMode() { digitalWrite(LORA_M0, LOW); digitalWrite(LORA_M1, LOW); delay(10); }

void readDHT22Sensor() {
  unsigned long now = millis();
  if (now - sensorData.lastDHTReadTime < 2500) return; 
  float temp = dht.readTemperature(); float humidity = dht.readHumidity();     
  if (isnan(temp) || isnan(humidity)) {
    sensorData.dhtErrorCount++; sensorData.isDHTValid = false;
    if (sensorData.dhtErrorCount > 3) { sensorData.AirTemp = -1.0; sensorData.AirHum = -1.0; dht.begin(); }
  } else {
    sensorData.AirTemp = temp; sensorData.AirHum = humidity; sensorData.isDHTValid = true; sensorData.dhtErrorCount = 0; 
  }
  sensorData.lastDHTReadTime = now;
}

void readRainSensor() {
  unsigned long now = millis();
  if (now - sensorData.lastRainReadTime < 100) return; 
  int rawADC = analogRead(RAIN_SENSOR_PIN); int smoothedADC = rainFilter.addSample(rawADC);
  sensorData.RainPercent = mapADCToRainPercent(smoothedADC); sensorData.RainRawADC = smoothedADC;
  sensorData.isRainValid = true; sensorData.lastRainReadTime = now;
}

float readUltrasonic(uint32_t echoPin) {
  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10); digitalWrite(TRIG_PIN, LOW);
  unsigned long duration = pulseIn(echoPin, HIGH, 35000); 
  if (duration == 0) return -1.0;  
  return (duration * 0.0343) / 2.0;  
}

void readAllUltrasonic() {
  unsigned long now = millis();
  if (now - sensorData.lastUltrasonicReadTime < 1000) return; 
  float d1 = readUltrasonic(ECHO1_PIN); if(d1 > 0) sensorData.Dist1 = d1; delay(60); 
  float d2 = readUltrasonic(ECHO2_PIN); if(d2 > 0) sensorData.Dist2 = d2; delay(60); 
  float d3 = readUltrasonic(ECHO3_PIN); if(d3 > 0) sensorData.Dist3 = d3; delay(60); 
  float rawD4 = readUltrasonic(ECHO4_PIN);
  if(rawD4 > 0) sensorData.Dist4 = rawD4 + 13.0; else if(sensorData.Dist4 <= 0) sensorData.Dist4 = -1.0; 
  sensorData.isUltrasonicValid = (sensorData.Dist1 > 0) && (sensorData.Dist2 > 0) && (sensorData.Dist3 > 0) && (sensorData.Dist4 > 0);
  sensorData.lastUltrasonicReadTime = now;
}

uint16_t Modbus_CRC16(const uint8_t *buf, uint8_t len) {
  uint16_t crc = 0xFFFF;
  for (int pos = 0; pos < len; pos++) {
    crc ^= (uint16_t)buf[pos];
    for (int i = 8; i != 0; i--) {
      if ((crc & 0x0001) != 0) { crc >>= 1; crc ^= 0xA001; } else { crc >>= 1; }
    }
  } return crc;
}

unsigned long modbusRequestTime = 0; bool isWaitingModbus = false;

void requestModbusSensor() {
  uint8_t txData[8] = {SENSOR_ID, 0x03, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00};
  uint16_t crc = Modbus_CRC16(txData, 6);
  txData[6] = crc & 0xFF; txData[7] = (crc >> 8) & 0xFF;
  while (RS485_Serial.available()) { RS485_Serial.read(); } 
  RS485_Serial.write(txData, 8);
  modbusRequestTime = millis(); isWaitingModbus = true;
}

void processModbusSensor() {
  if (!isWaitingModbus) return;
  
  if (millis() - modbusRequestTime > 200) { 
    sensorData.modbusErrorCount++; 
    isWaitingModbus = false; 
    goto CHECK_MODBUS_ERROR; 
  }

  while (RS485_Serial.available() > 0 && RS485_Serial.peek() != SENSOR_ID) {
    RS485_Serial.read(); 
  }

  if (RS485_Serial.available() >= 19) {
    uint8_t rxData[19]; 
    for (int i = 0; i < 19; i++) rxData[i] = RS485_Serial.read();
    
    if (rxData[0] == SENSOR_ID && rxData[1] == 0x03 && rxData[2] == 14) {
      if (((rxData[18] << 8) | rxData[17]) == Modbus_CRC16(rxData, 17)) {
        
        float rawHum  = (int16_t)((rxData[3] << 8)  | rxData[4]) / 10.0;
        float rawTemp = (int16_t)((rxData[5] << 8)  | rxData[6]) / 10.0;
        float rawEC   = (uint16_t)((rxData[7] << 8) | rxData[8]) / 1000.0; // Chia 1000 đổi ra mS/cm
        float rawPH   = (int16_t)((rxData[9] << 8)  | rxData[10]) / 100.0; // Chia 100 sửa lỗi pH
        int rawN      = (int16_t)((rxData[11] << 8) | rxData[12]);
        int rawP      = (int16_t)((rxData[13] << 8) | rxData[14]);
        int rawK      = (int16_t)((rxData[15] << 8) | rxData[16]);

        if (rawHum >= 0.0 && rawHum <= 100.0) {
            sensorData.Humidity    = humFilter.addSample(rawHum);
            sensorData.Temperature = tempFilter.addSample(rawTemp);
            sensorData.EC_Value    = ecFilter.addSample(rawEC);
            sensorData.pH_Value    = phFilter.addSample(rawPH);
            sensorData.Nitrogen    = nFilter.addSample(rawN);
            sensorData.Phosphorus  = pFilter.addSample(rawP);
            sensorData.Potassium   = kFilter.addSample(rawK);

            sensorData.isModbusValid = true; 
            sensorData.modbusErrorCount = 0;
        } else {
            sensorData.modbusErrorCount++; sensorData.isModbusValid = false;
        }
      } else { 
        sensorData.modbusErrorCount++; sensorData.isModbusValid = false; 
      }
    } else { 
      sensorData.modbusErrorCount++; sensorData.isModbusValid = false; 
    }
    isWaitingModbus = false;
  }
  
CHECK_MODBUS_ERROR:
  if (sensorData.modbusErrorCount > 5) {
    sensorData.Temperature = -1.0; sensorData.Humidity = -1.0; sensorData.pH_Value = -1.0;
    sensorData.EC_Value = 0.0; sensorData.Nitrogen = 0; sensorData.Phosphorus = 0; sensorData.Potassium = 0;
  }
}

void prepareLoraSensorData() {
  loraPendingPayload = "<A:DATA:" +
                   String(sensorData.Temperature, 1) + "," + String(sensorData.Humidity, 1) + "," + String(sensorData.EC_Value, 2) + "," +
                   String(sensorData.pH_Value, 1) + "," + String(sensorData.Nitrogen) + "," + String(sensorData.Phosphorus) + "," +
                   String(sensorData.Potassium) + "," + String(sensorData.Dist1, 1) + "," + String(sensorData.Dist2, 1) + "," +
                   String(sensorData.Dist3, 1) + "," + String(sensorData.Dist4, 1) + "," + String(sensorData.RainPercent) + "," +
                   String(sensorData.AirTemp, 1) + "," + String(sensorData.AirHum, 1) + ">";
  
  isSendingLora = true;
  loraTxTimer = millis(); 
}

void processLoraCommand(const String &cmd) {
  if (!cmd.startsWith("<A:") || !cmd.endsWith(">")) return; 
  String body = cmd.substring(3, cmd.length() - 1); 
  if (body == "GET_DATA") {
    sysMessage = "DANG GUI DATA...";
    sysMessageTime = millis();
    prepareLoraSensorData();
  }
}

void checkLoraIncoming() {
  while (loraSerial.available()) {
    char c = loraSerial.read();
    if (c == '\n' || c == '\r') {
      loraRxBuffer.trim();
      if (loraRxBuffer.length() > 0) processLoraCommand(loraRxBuffer);
      loraRxBuffer = "";
    } else {
      loraRxBuffer += c;
      if (loraRxBuffer.length() > 64) loraRxBuffer = ""; 
    }
  }
}

void renderLCD() {
  if (millis() - sysMessageTime < 2500 && sysMessage != "") {
    static String lastMsg = "";
    if (!isShowingMsg || sysMessage != lastMsg) {
      lcd.clear();
      lcd.setCursor(0, 0); lcd.print(">>> LORA RX <<<");
      lcd.setCursor(0, 1); lcd.print(sysMessage);
      lastMsg = sysMessage;
      isShowingMsg = true;
    }
    return; 
  }
  
  static uint8_t lastPage = 255;
  if (isShowingMsg) {
    lcd.clear();
    isShowingMsg = false;
    lastPage = 255; 
  }

  if (lcdPage != lastPage) { lcd.clear(); lastPage = lcdPage; }
  
  if (lcdPage == 0) {
    lcd.setCursor(0, 0); lcd.print("T:"); lcd.print(sensorData.Temperature, 1); lcd.print("C "); lcd.print("H:"); lcd.print(sensorData.Humidity, 1); lcd.print("%   ");
    lcd.setCursor(0, 1); lcd.print("EC:"); lcd.print(sensorData.EC_Value, 2); lcd.print(" "); lcd.print("pH:"); lcd.print(sensorData.pH_Value, 1); lcd.print("    ");
  } else if (lcdPage == 1) {
    lcd.setCursor(0, 0); lcd.print("Dinh duong (NPK) ");
    lcd.setCursor(0, 1); lcd.print("N:"); lcd.print(sensorData.Nitrogen); lcd.print(" P:"); lcd.print(sensorData.Phosphorus); lcd.print(" K:"); lcd.print(sensorData.Potassium); lcd.print("   "); 
  } else if (lcdPage == 2) {
    lcd.setCursor(0, 0); lcd.print("A:"); lcd.print(sensorData.AirTemp, 1); lcd.print("C  "); lcd.print("R:"); lcd.print(sensorData.RainPercent); lcd.print("%   ");
    lcd.setCursor(0, 1); lcd.print("H:"); lcd.print(sensorData.AirHum, 1); lcd.print("% "); lcd.print("A:"); lcd.print(sensorData.RainRawADC); lcd.print("   ");
  } else {
    lcd.setCursor(0, 0); lcd.print("K:"); lcd.print((int)sensorData.Dist3); lcd.print("cm "); lcd.print("W:"); lcd.print((int)sensorData.Dist4); lcd.print("cm  ");
    lcd.setCursor(0, 1); lcd.print("D1:"); lcd.print((int)sensorData.Dist1); lcd.print("cm "); lcd.print("D2:"); lcd.print((int)sensorData.Dist2); lcd.print("cm  ");
  }
}

void handleButtons() {
  unsigned long currentMillis = millis();
  bool readingBtn1 = digitalRead(BTN1_PIN);
  if (readingBtn1 != lastBtn1State) { lastBtn1Debounce = currentMillis; }
  if ((currentMillis - lastBtn1Debounce) > DEBOUNCE_DELAY) {
    static bool btn1ProcessedState = HIGH;
    if (readingBtn1 != btn1ProcessedState) { btn1ProcessedState = readingBtn1; if (btn1ProcessedState == LOW) { lcdPage = (lcdPage + 1) % 4; renderLCD(); } }
  }
  lastBtn1State = readingBtn1;
  bool readingBtn2 = digitalRead(BTN2_PIN);
  if (readingBtn2 != lastBtn2State) { lastBtn2Debounce = currentMillis; }
  if ((currentMillis - lastBtn2Debounce) > DEBOUNCE_DELAY) {
    static bool btn2ProcessedState = HIGH;
    if (readingBtn2 != btn2ProcessedState) { btn2ProcessedState = readingBtn2; if (btn2ProcessedState == LOW) debugForceSend = true; }
  }
  lastBtn2State = readingBtn2;
}

void setup() {
  Serial.begin(115200); analogReadResolution(12); 
  pinMode(BTN1_PIN, INPUT); pinMode(BTN2_PIN, INPUT);
  pinMode(TRIG_PIN, OUTPUT); digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO1_PIN, INPUT); pinMode(ECHO2_PIN, INPUT); pinMode(ECHO3_PIN, INPUT); pinMode(ECHO4_PIN, INPUT);
  pinMode(LORA_M0, OUTPUT); pinMode(LORA_M1, OUTPUT); setLoraNormalMode();
  Wire.setSDA(PB9); Wire.setSCL(PB8); Wire.begin();
  lcd.init(); lcd.backlight(); lcd.setCursor(0, 0); lcd.print("Khoi dong he...");
  RS485_Serial.begin(9600, SERIAL_8N1); loraSerial.begin(9600, SERIAL_8N1); dht.begin();
  delay(1000); lcd.clear();
}

unsigned long lastModbusReq = 0;

void loop() {
  unsigned long currentMillis = millis();
  
  if (currentMillis - lastModbusReq >= 2000 && !isWaitingModbus) { requestModbusSensor(); lastModbusReq = currentMillis; }
  processModbusSensor(); readDHT22Sensor(); readRainSensor();        
  if (!isWaitingModbus) readAllUltrasonic();     
  
  renderLCD();
  handleButtons();
  checkLoraIncoming();

  if (isSendingLora && (currentMillis - loraTxTimer >= 150)) {
    loraSerial.println(loraPendingPayload);
    isSendingLora = false;
  }

  if (debugForceSend) {
    debugForceSend = false;
    sysMessage = "MANUAL SEND...";
    sysMessageTime = millis();
    prepareLoraSensorData();
  }
}