# ⚠️ ĐỪNG NẠP CÁC FILE TRONG THƯ MỤC NÀY

Đây là **bản gốc y nguyên** nhóm phần cứng gửi sang, giữ lại **chỉ để đối
chiếu**. Nhóm phần cứng không dùng git nên mỗi lần sửa là gửi nguyên file mới;
thư mục này ghi lại đúng cái đã nhận.

**Muốn nạp chip thì dùng [`../firmware/`](../firmware/)** — đó là bản đã ghép
cầu nối web và đã vá lỗi.

| File ở đây | Bản dùng thật |
|---|---|
| `esp32loraaaa.ino` | [`../firmware/esp32_master/esp32_master.ino`](../firmware/esp32_master/esp32_master.ino) |
| `main.cpp` | [`../firmware/stm32_sensor_node/src/main.cpp`](../firmware/stm32_sensor_node/src/main.cpp) |
| `nano22222.ino` | [`../firmware/nano_relay/nano_relay.ino`](../firmware/nano_relay/nano_relay.ino) — giống hệt, không sửa gì |

## Bản ở đây thiếu 5 thứ

Nạp thẳng file trong thư mục này thì gặp lại đúng những lỗi sau:

1. **Sai đơn vị EC** — mặc định `1.0`/`2.0` (mS/cm) đem so với `EC_Value` (µS/cm,
   cỡ 1500). Máy pha phân kẹt vĩnh viễn, **tưới tự động không bao giờ chạy**.
2. **`preferences.end()` gọi trước khi đọc** — 10 ngưỡng lưu trên Nextion không
   bao giờ nạp lại sau khi khởi động.
3. **Không hỏi `/api/status`** — nút DỪNG KHẨN CẤP trên web hoàn toàn vô tác dụng.
4. **Không chặn lệnh tay khi đang AUTO** — web báo bơm ĐANG BẬT trong khi Nano
   đã từ chối, dashboard vẽ trạng thái không có thật.
5. **`return` khi Nextion gửi chuỗi rỗng** — một byte rác thoát khỏi cả `loop()`,
   bỏ luôn khối gửi lại LoRa.

Xem lịch sử git để biết chính xác đã sửa gì: commit *"Adopt the hardware team's
new firmware drop as received"* là bản gốc, commit ngay sau đó là phần vá.

## Lần sau nhận file mới

1. Chép file mới đè vào thư mục này, commit riêng một mình nó
2. Chép sang `../firmware/`, vá lại 5 điểm trên, commit riêng
3. Diff hai commit ra đúng danh sách những gì phải vá — không phải dò lại từ đầu
