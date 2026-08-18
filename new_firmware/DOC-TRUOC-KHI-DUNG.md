# ⚠️ ĐỪNG NẠP CÁC FILE TRONG THƯ MỤC NÀY

Đây là **bản gốc y nguyên** nhóm phần cứng gửi sang, giữ lại **chỉ để đối
chiếu**. Nhóm phần cứng không dùng git nên mỗi lần sửa là gửi nguyên file mới;
thư mục này ghi lại đúng cái đã nhận.

**Muốn nạp chip thì dùng [`../firmware/`](../firmware/)** — bản đã vá lỗi.

| File ở đây | Bản dùng thật |
|---|---|
| `esp32_master (1).ino` | [`../firmware/esp32_master/esp32_master.ino`](../firmware/esp32_master/esp32_master.ino) |
| `stm32_sensor_node.ino` | [`../firmware/stm32_sensor_node/stm32_sensor_node.ino`](../firmware/stm32_sensor_node/stm32_sensor_node.ino) |
| `nano_actuator (1).ino` | [`../firmware/nano_relay/nano_relay.ino`](../firmware/nano_relay/nano_relay.ino) |

## Bản ở đây không biên dịch được, và thiếu 5 thứ

Đã kiểm bằng `arduino-cli` thật, không phải đọc suông:

1. **STM32 không build được** — `HardwareSerial Serial1(PA10, PA9)` trùng tên
   biến core đã định nghĩa sẵn, trình liên kết báo *multiple definition of
   `Serial1`*. Bản trong `firmware/` đổi tên thành `rs485Port`.
2. **Nano tràn RAM** — dùng 89% (1825/2048 byte), chỉ còn **223 byte** cho stack
   trong khi code dùng `String` liên tục. Bản trong `firmware/` bọc `F()` cho 22
   chuỗi, xuống còn 52%.
3. **Sai đơn vị EC** — mặc định `1.0`/`2.0` (mS/cm) đem so với `EC_Value`
   (µS/cm, cỡ 1500). Máy pha phân kẹt vĩnh viễn, **tưới tự động không bao giờ chạy**.
4. **Trạng thái relay không được ghi khi Nano ACK** — lệnh do máy AUTO tự sinh
   ra không cập nhật `pumpState[]`, nên dashboard báo mọi bơm OFF dù đang chạy.
5. **Bấm nút trên Nextion khi chưa chọn chế độ / đang chờ ACK thì im lặng** —
   không phản hồi gì, mà nút thì đã tự đổi màu.

## Lần sau nhận file mới

1. Chép file mới đè vào thư mục này, commit riêng một mình nó
2. Chép sang `../firmware/`, vá lại, commit riêng
3. Diff hai commit ra đúng danh sách phải vá — không phải dò lại từ đầu

## Biên dịch kiểm tra

```bash
CLI="$LOCALAPPDATA/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"
"$CLI" compile --fqbn esp32:esp32:esp32s3 firmware/esp32_master
"$CLI" compile --fqbn "STMicroelectronics:stm32:GenF4:pnum=BLACKPILL_F411CE" firmware/stm32_sensor_node
"$CLI" compile --fqbn arduino:avr:nano firmware/nano_relay
```

> STM32 phải dùng core **2.7.1**, không phải 3.0.0 — bản 3.0 đổi `HardwareSerial`
> thành lớp trừu tượng nên code này không build được.
