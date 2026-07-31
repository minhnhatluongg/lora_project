#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);
HardwareSerial Serial1(PA10, PA9); // RX = PA10, TX = PA9
#define RS485_Serial Serial1

// --- UART GỬI DỮ LIỆU LÊN ESP32 (đi tiếp qua WiFi vào backend) ---
// Serial1 đã bận cho RS485, Serial (USB CDC) dành cho debug -> dùng USART2.
// Nối: STM32 PA2 (TX) -> ESP32 RX  |  STM32 PA3 (RX) <- ESP32 TX  |  GND chung.
HardwareSerial Serial2(PA3, PA2);  // RX = PA3, TX = PA2
#define ESP_Serial Serial2

// --- KHAI BÁO CHÂN NÚT NHẤN ---
#define BTN1_PIN PB5  // SW1: Đổi trang hiển thị LCD (3 trang)
#define BTN2_PIN PB7  // SW2: Đọc cảm biến ngay lập tức

// --- KHAI BÁO CHÂN 4 CẢM BIẾN SIÊU ÂM (TRIG CHUNG) ---
#define TRIG_PIN  PB12
#define ECHO1_PIN PB13 // Cảm biến 1
#define ECHO2_PIN PB14 // Cảm biến 2
#define ECHO3_PIN PB15 // Cảm biến 3
#define ECHO4_PIN PA8  // Cảm biến 4

// Khai báo biến lưu trữ cảm biến đất
float Temperature = 0.0;
float Humidity = 0.0;
uint16_t EC_Value = 0;
float pH_Value = 0.0;
uint16_t Nitrogen = 0;
uint16_t Phosphorus = 0;
uint16_t Potassium = 0;

// Khai báo biến lưu trữ 4 khoảng cách siêu âm (cm)
float Dist1 = 0.0;
float Dist2 = 0.0;
float Dist3 = 0.0;
float Dist4 = 0.0;

// Cờ báo đã từng đọc thành công đầu dò đất ít nhất 1 lần.
// Trước lần đó, 7 biến ở trên vẫn đang là 0 -> KHÔNG được gửi lên server,
// nếu không dashboard sẽ ghi nhận pH=0, độ ẩm=0... và bắn cảnh báo giả.
bool soilDataValid = false;

// Biến quản lý trạng thái Nút nhấn
uint8_t lcdPage = 0;          // 0: T/H/EC/pH | 1: N/P/K | 2: Siêu âm D1..D4
bool forceReadNext = false;   // Cờ báo yêu cầu đo ngay lập tức
unsigned long lastBtn1Debounce = 0;
unsigned long lastBtn2Debounce = 0;
const unsigned long DEBOUNCE_DELAY = 30; // Chống dội phím 30ms

bool lastBtn1State = HIGH;
bool lastBtn2State = HIGH;

// --- HÀM ĐỌC 1 CẢM BIẾN SIÊU ÂM TRÊN CHÂN TRIG CHUNG ---
float readUltrasonic(uint32_t echoPin) {
    // 1. Kích hoạt xung Trig 10us
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    
    // 2. Đọc thời gian phản hồi xung HIGH từ chân Echo
    // Timeout 25000us (25ms) ~ khoảng cách đo tối đa 400cm, tránh treo chip
    unsigned long duration = pulseIn(echoPin, HIGH, 25000);
    
    if (duration == 0) {
        return -1.0; // -1: Không nhận được phản hồi / Ngoài tầm đo
    }
    
    // Tốc độ âm thanh: 343 m/s => khoảng cách = (thời gian * 0.0343) / 2
    return (duration * 0.0343) / 2.0;
}

// --- HÀM CẬP NHẬT ĐỒNG THỜI 4 CẢM BIẾN SIÊU ÂM ---
void readAllUltrasonic() {
    Dist1 = readUltrasonic(ECHO1_PIN);
    delay(10); // Nghỉ 10ms giữa các lần đọc để sóng siêu âm tan hết, chống nhiễu
    Dist2 = readUltrasonic(ECHO2_PIN);
    delay(10);
    Dist3 = readUltrasonic(ECHO3_PIN);
    delay(10);
    Dist4 = readUltrasonic(ECHO4_PIN);
}

// Hàm tính Modbus CRC16 chuẩn
uint16_t Modbus_CRC16(const uint8_t *buf, uint8_t len) {
    uint16_t crc = 0xFFFF;
    for (int pos = 0; pos < len; pos++) {
        crc ^= (uint16_t)buf[pos];
        for (int i = 8; i != 0; i--) {
            if ((crc & 0x0001) != 0) {
                crc >>= 1;
                crc ^= 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    return crc;
}

// --- GỬI 1 DÒNG JSON LÊN ESP32 SAU MỖI LƯỢT ĐỌC ---
// ESP32 chỉ việc đọc tới ký tự '\n' rồi POST nguyên văn lên /api/telemetry.
// status: "OK" | "CRC" | "HEADER" | "TIMEOUT" | "SHORT" -> dashboard hiển thị
// đúng lý do khi dữ liệu ngừng cập nhật.
// Khoảng cách bằng -1 (siêu âm không phản hồi) được backend lưu thành null.
void sendUplink(const char *status) {
    ESP_Serial.print(F("{"));

    // 4 cảm biến siêu âm luôn được đo mới ở MỌI vòng lặp, kể cả khi RS485 lỗi,
    // nên chúng luôn được gửi. -1 = không có phản hồi, server lưu thành null.
    ESP_Serial.print(F("\"dist1\":"));  ESP_Serial.print(Dist1, 1);      // cm
    ESP_Serial.print(F(",\"dist2\":")); ESP_Serial.print(Dist2, 1);
    ESP_Serial.print(F(",\"dist3\":")); ESP_Serial.print(Dist3, 1);
    ESP_Serial.print(F(",\"dist4\":")); ESP_Serial.print(Dist4, 1);

    // 7 chỉ số đất chỉ gửi khi đã đọc được ít nhất một lần. Khi RS485 đang lỗi,
    // đây là giá trị đọc được lần cuối - server vẫn nhận biết nhờ sensor_status.
    if (soilDataValid) {
        ESP_Serial.print(F(",\"temperature\":")); ESP_Serial.print(Temperature, 1);
        ESP_Serial.print(F(",\"humidity\":"));    ESP_Serial.print(Humidity, 1);
        ESP_Serial.print(F(",\"ph\":"));          ESP_Serial.print(pH_Value, 1);
        ESP_Serial.print(F(",\"ec\":"));          ESP_Serial.print(EC_Value);   // µS/cm
        ESP_Serial.print(F(",\"n\":"));           ESP_Serial.print(Nitrogen);   // mg/kg
        ESP_Serial.print(F(",\"p\":"));           ESP_Serial.print(Phosphorus);
        ESP_Serial.print(F(",\"k\":"));           ESP_Serial.print(Potassium);
    }

    ESP_Serial.print(F(",\"sensor_status\":\"")); ESP_Serial.print(status);
    ESP_Serial.println(F("\"}"));
}

// --- HÀM HIỂN THỊ MÀN HÌNH LCD THEO TRANG ---
void renderLCD() {
    if (lcdPage == 0) {
        // TRANG 0: T:25.1C H:45.2%
        lcd.setCursor(0, 0);
        lcd.print("T:"); lcd.print(Temperature, 1); lcd.print("C H:");
        lcd.print(Humidity, 1);                     lcd.print("%   ");
        
        // Dòng 2: EC:1200  pH:6.5
        lcd.setCursor(0, 1);
        lcd.print("EC:"); lcd.print(EC_Value);      lcd.print(" pH:");
        lcd.print(pH_Value, 1);                     lcd.print("    ");
    } 
    else if (lcdPage == 1) {
        // TRANG 1: Dinh duong (NPK)
        lcd.setCursor(0, 0);
        lcd.print("Dinh duong (NPK)");
        
        // Dòng 2: N:123 P:45 K:67
        lcd.setCursor(0, 1);
        lcd.print("N:"); lcd.print(Nitrogen);
        lcd.print(" P:"); lcd.print(Phosphorus);
        lcd.print(" K:"); lcd.print(Potassium);
        lcd.print("   ");
    } 
    else {
        // TRANG 2: Khoảng cách 4 cảm biến siêu âm (đơn vị cm)
        // Dòng 1: D1:123  D2:45
        lcd.setCursor(0, 0);
        lcd.print("D1:");
        if (Dist1 < 0) lcd.print("ERR"); else lcd.print((int)Dist1);
        lcd.print("  D2:");
        if (Dist2 < 0) lcd.print("ERR"); else lcd.print((int)Dist2);
        lcd.print("    ");
        
        // Dòng 2: D3:67   D4:89
        lcd.setCursor(0, 1);
        lcd.print("D3:");
        if (Dist3 < 0) lcd.print("ERR"); else lcd.print((int)Dist3);
        lcd.print("  D4:");
        if (Dist4 < 0) lcd.print("ERR"); else lcd.print((int)Dist4);
        lcd.print("    ");
    }
}

// --- HÀM XỬ LÝ NÚT NHẤN ---
void handleButtons() {
    unsigned long currentMillis = millis();

    // 1. ĐỌC NÚT PB5: Chuyển vòng 3 trang LCD (0 -> 1 -> 2 -> 0)
    bool readingBtn1 = digitalRead(BTN1_PIN);
    if (readingBtn1 != lastBtn1State) {
        lastBtn1Debounce = currentMillis;
    }
    if ((currentMillis - lastBtn1Debounce) > DEBOUNCE_DELAY) {
        static bool btn1ProcessedState = HIGH;
        if (readingBtn1 != btn1ProcessedState) {
            btn1ProcessedState = readingBtn1;
            if (btn1ProcessedState == LOW) { // Nhấn nút (GND)
                lcdPage = (lcdPage + 1) % 3; // Lặp trang 0, 1, 2
                renderLCD();                 // Cập nhật màn hình ngay
                Serial.print(">> [PB5] Chuyển trang LCD sang: ");
                Serial.println(lcdPage);
            }
        }
    }
    lastBtn1State = readingBtn1;

    // 2. ĐỌC NÚT PB7: Đọc cảm biến ngay lập tức
    bool readingBtn2 = digitalRead(BTN2_PIN);
    if (readingBtn2 != lastBtn2State) {
        lastBtn2Debounce = currentMillis;
    }
    if ((currentMillis - lastBtn2Debounce) > DEBOUNCE_DELAY) {
        static bool btn2ProcessedState = HIGH;
        if (readingBtn2 != btn2ProcessedState) {
            btn2ProcessedState = readingBtn2;
            if (btn2ProcessedState == LOW) { // Nhấn nút (GND)
                forceReadNext = true;        // Bật cờ đo ngay
                Serial.println(">> [PB7] Yêu cầu đo cảm biến ngay lập tức!");
            }
        }
    }
    lastBtn2State = readingBtn2;
}

void setup() {
    Serial.begin(115200);
    
    // Cấu hình Nút nhấn (Dùng trở kéo lên 10K ngoài -> INPUT chuẩn)
    pinMode(BTN1_PIN, INPUT);
    pinMode(BTN2_PIN, INPUT);
    
    // Cấu hình Chân Siêu Âm
    pinMode(TRIG_PIN, OUTPUT);
    digitalWrite(TRIG_PIN, LOW); // Mặc định ở mức LOW
    
    pinMode(ECHO1_PIN, INPUT);
    pinMode(ECHO2_PIN, INPUT);
    pinMode(ECHO3_PIN, INPUT);
    pinMode(ECHO4_PIN, INPUT);
    
    // Khởi tạo I2C cho LCD (SDA = PB9, SCL = PB8 trên STM32)
    Wire.setSDA(PB9);
    Wire.setSCL(PB8);
    Wire.begin(); 
    
    lcd.init();       
    lcd.backlight();  
    
    lcd.setCursor(0, 0);
    lcd.print("Khoi dong he...");
    lcd.setCursor(0, 1);
    lcd.print("STM32 + RS485");
    delay(1500); 
    
    Serial.println("==================================================");
    Serial.println("He thong Modbus RS485 + 4 Sieu Am (STM32F411)");
    Serial.println("==================================================");

    // Cấu hình Serial1 với bộ đệm chuẩn
    RS485_Serial.begin(9600, SERIAL_8N1);

    // Kênh gửi dữ liệu lên ESP32
    ESP_Serial.begin(115200, SERIAL_8N1);
    delay(500);
    
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Dang doc dl...");
}

void loop() {
    // --------------------------------------------------------
    // BƯỚC 1: DỌN SẠCH BUFFER & GỬI LỆNH ĐỌC 7 THANH GHI MODBUS
    // --------------------------------------------------------
    while (RS485_Serial.available()) {
        RS485_Serial.read(); // Xóa rác trong bộ đệm nhận trước khi gửi
    }

    uint8_t txData[8] = {0x02, 0x03, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00};
    uint16_t crc = Modbus_CRC16(txData, 6);
    txData[6] = crc & 0xFF;        // CRC Low Byte
    txData[7] = (crc >> 8) & 0xFF; // CRC High Byte

    RS485_Serial.write(txData, 8);
    RS485_Serial.flush(); // Chờ gửi xong toàn bộ 8 byte
    
    // Quá trình chuyển hướng bus RS485 cần 2ms để ổn định
    delay(2); 

    // --------------------------------------------------------
    // BƯỚC 2: NHẬN PHẢN HỒI CHÍNH XÁC (SỬA LỖI TIMEOUT & TRÔI BYTE)
    // --------------------------------------------------------
    uint8_t rxData[19];
    int byteCount = 0;
    unsigned long startTime = millis();
    
    // Chờ tối đa 500ms cho đến khi đủ 19 byte
    while ((millis() - startTime < 500) && (byteCount < 19)) {
        if (RS485_Serial.available() > 0) {
            rxData[byteCount++] = RS485_Serial.read();
            // Gia hạn nhẹ thời gian chờ giữa các byte liên tiếp (Inter-character timeout)
            startTime = millis(); 
        }
        handleButtons(); // Quét nút phản hồi mượt
    }

    // --------------------------------------------------------
    // BƯỚC 3: ĐỌC 4 CẢM BIẾN SIÊU ÂM (TRIG CHUNG PB12)
    // --------------------------------------------------------
    readAllUltrasonic();

    // --------------------------------------------------------
    // BƯỚC 4: KIỂM TRA TÍNH HỢP LỆ VÀ PARSE DỮ LIỆU
    // --------------------------------------------------------
    if (byteCount == 19) {
        // Kiểm tra ID (0x02), Lệnh (0x03), Số byte data (14 = 0x0E)
        if (rxData[0] == 0x02 && rxData[1] == 0x03 && rxData[2] == 14) {
            
            uint16_t received_crc = (rxData[18] << 8) | rxData[17];
            uint16_t calculated_crc = Modbus_CRC16(rxData, 17);
            
            if (received_crc == calculated_crc) {
                // ĐỌC RAW DATA
                int16_t rawHum  = (rxData[3] << 8) | rxData[4];
                int16_t rawTemp = (rxData[5] << 8) | rxData[6];
                EC_Value        = (rxData[7] << 8) | rxData[8];
                uint16_t rawPH  = (rxData[9] << 8) | rxData[10];
                Nitrogen        = (rxData[11] << 8) | rxData[12];
                Phosphorus      = (rxData[13] << 8) | rxData[14];
                Potassium       = (rxData[15] << 8) | rxData[16];

                // CHUẨN HÓA SỐ LIỆU
                Humidity = rawHum / 10.0;
                Temperature = rawTemp / 10.0;
                pH_Value = rawPH / 10.0;
                soilDataValid = true; // từ đây trở đi mới được gửi 7 chỉ số đất

                // --- IN RA SERIAL MONITOR ---
                Serial.print("Do am dat: "); Serial.print(Humidity, 1); Serial.println(" %");
                Serial.print("Nhiet do:  "); Serial.print(Temperature, 1); Serial.println(" °C");
                Serial.print("EC:        "); Serial.print(EC_Value); Serial.println(" us/cm");
                Serial.print("pH:        "); Serial.print(pH_Value, 1); Serial.println("");
                Serial.print("Nito (N):  "); Serial.print(Nitrogen); Serial.println(" mg/kg");
                Serial.print("Photpho(P):"); Serial.print(Phosphorus); Serial.println(" mg/kg");
                Serial.print("Kali (K):  "); Serial.print(Potassium); Serial.println(" mg/kg");
                Serial.println("--- SIÊU ÂM (cm) ---");
                Serial.printf("D1: %.1f | D2: %.1f | D3: %.1f | D4: %.1f\r\n", Dist1, Dist2, Dist3, Dist4);
                Serial.println("----------------------------------------");
                
                // --- HIỂN THỊ LCD 1602 THEO TRANG ---
                renderLCD();

                // --- ĐẨY LÊN ESP32 -> BACKEND ---
                sendUplink("OK");

            } else {
                Serial.println("Loi: CRC khong khop!");
                lcd.setCursor(0, 0); lcd.print("Loi CRC Data!   ");
                sendUplink("CRC");
            }
        } else {
            Serial.println("Loi: Sai header Modbus!");
            sendUplink("HEADER");
        }
    } else if (byteCount == 0) {
        Serial.println("Loi: Khong phan hoi (Mat ket noi)");
        lcd.setCursor(0, 0); lcd.print("Mat ket noi RS485");
        lcd.setCursor(0, 1); lcd.print("Kiem tra day cap ");
        sendUplink("TIMEOUT");
    } else {
        Serial.print("Loi: Nhan thieu byte: ");
        Serial.println(byteCount);
        lcd.setCursor(0, 0); lcd.print("Loi: Thieu byte ");
        lcd.setCursor(0, 1); lcd.print("Nhan duoc: "); lcd.print(byteCount); lcd.print("B   ");
        sendUplink("SHORT");
    }

    // --------------------------------------------------------
    // BƯỚC 5: CHỜ 2 GIÂY TRƯỚC KHI ĐỌC LẦN TIẾP THEO (CÓ QUÉT NÚT)
    // --------------------------------------------------------
    unsigned long waitStart = millis();
    while (millis() - waitStart < 2000) {
        handleButtons(); // Liên tục kiểm tra phím bấm trong thời gian chờ
        
        // Nếu nhấn PB7 (forceReadNext), lập tức thoát vòng chờ để đo ngay!
        if (forceReadNext) {
            forceReadNext = false; // Xóa cờ cho lần sau
            break; 
        }
    }
}