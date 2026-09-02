# Hai bảng chẩn đoán — cách đọc và cách trình bày

Hai bảng này nằm ở **cuối trang DASHBOARD**, dưới mục *"Phân tích chi tiết"*.
Cuộn xuống hết là thấy.

Cả hai **không thu thập gì mới**. Chúng đọc dữ liệu hệ thống đã ghi từ trước
nhưng chưa màn hình nào dùng tới:

| Bảng | Đọc từ | Đã có từ |
|---|---|---|
| Chất lượng sóng WiFi | `telemetry.wifi_rssi` | từ bản firmware nạp sau ngày 2/9/2026 |
| Đường đi của lệnh | `commands.created_at / run_after / sent_at / acked_at` | từ khi có hàng đợi lệnh |

---

## 1. Chất lượng sóng WiFi

> **Vì sao không phải sóng LoRa.** Bảng này ban đầu định vẽ đoạn đáng quan tâm
> hơn — giữa node cảm biến và ESP32. Nhưng module LoRa **E32** nối qua UART
> **không có lệnh đọc RSSI**, nên firmware chưa bao giờ gửi được giá trị nào và
> cột `lora_rssi` rỗng từ đầu. Muốn đo thật đoạn đó phải đổi sang module dòng
> **E22**. `WiFi.RSSI()` thì đo được ngay, không đổi phần cứng — khác đoạn
> đường truyền, nhưng vẫn là số đo RF thật.

### Con số này là gì

**RSSI** (Received Signal Strength Indicator) — cường độ sóng **giữa ESP32 và
router WiFi**. Đơn vị dBm, luôn là số âm. **Càng gần 0 càng mạnh.**

| Mức | Ý nghĩa |
|---|---|
| trên −60 dBm | Tốt |
| −60 đến −75 dBm | Trung bình |
| dưới −75 dBm | Yếu |

Ngưỡng của WiFi **khác hẳn LoRa**: LoRa thu tới −120 dBm vẫn giải mã tốt nhờ
trải phổ, còn WiFi xuống dưới −75 dBm là đã rớt gói và chậm thấy rõ.

Ba dải này vẽ mờ làm nền biểu đồ, nên nhìn đường nằm ở dải nào là biết ngay,
không phải nhẩm ngưỡng.

### Đọc biểu đồ

- **Đường liền** — mỗi điểm là trung bình RSSI trong một ô thời gian. Chọn khung
  1 giờ / 6 giờ / 24 giờ / 7 ngày ở góc phải; ô thời gian tự giãn theo.
- **Chỗ đứt đoạn** — quãng **không có gói nào về**. Đường cố ý ngắt chứ không nối
  liền qua: nối lại là xoá mất chính cái thông tin quan trọng nhất.
- **Rê chuột** vào biểu đồ hiện thêm giá trị **yếu nhất** trong ô đó và **số gói**
  nhận được — trung bình đẹp mà chỉ có 2 gói thì khác hẳn trung bình đẹp với 120 gói.

### Bảy ô thống kê

| Ô | Nghĩa |
|---|---|
| **Hiện tại** | Điểm cuối cùng trên biểu đồ |
| **Trung bình** | Trung bình toàn khung đang chọn |
| **Mạnh nhất / Yếu nhất** | Hai cực trị — khoảng cách giữa chúng cho biết đường truyền ổn định hay chập chờn |
| **Số gói đã nhận** | Số dòng đo có kèm RSSI trong khung |
| **Lần mất liên lạc** | Số quãng im lặng dài bất thường |
| **Lâu nhất** | Quãng im lặng dài nhất |

### Một giới hạn phải nói thật

Giao thức LoRa giữa hai node **không đánh số thứ tự gói**. Không có số thứ tự thì
không có cách nào biết gói nào đã mất — nên hệ thống **không công bố "tỉ lệ mất
gói %"**, vì con số đó sẽ là bịa.

Thứ đo được thật là **khoảng trống**: quãng thời gian dài bất thường giữa hai
dòng đo liên tiếp. Ngưỡng "bất thường" không cắm cứng mà lấy từ chính dữ liệu —
gấp 5 lần **nhịp gửi trung vị** đo được, tối thiểu 30 giây. Dùng trung vị chứ
không dùng trung bình, vì một lần mất mạng nửa tiếng sẽ kéo trung bình lên và
làm chính cái ngưỡng phát hiện mất mạng trở nên vô dụng.

Dòng chú thích xám ngay dưới các ô thống kê nói lại điều này, kèm ngưỡng thật
đang áp dụng. **Đừng xoá nó** — một con số kèm điều kiện thì phải đọc được cùng
lúc với điều kiện của nó.

### Cách diễn trước hội đồng

1. Mở khung **1 giờ**, chỉ vào đường và nói đây là sóng thật giữa ESP32 và router.
2. **Cầm tủ điện (hoặc ESP32) đi xa router dần** — ra hành lang, xuống tầng.
   Đường tụt xuống thấy rõ trong vòng vài giây.
3. Đi đủ xa cho mất hẳn → đường **đứt đoạn**, ô *Lần mất liên lạc* tăng lên 1.
4. Mang lại gần → đường nối lại ở mức cao.

Nếu hội đồng hỏi vì sao không đo sóng LoRa, trả lời thẳng: **module E32 không
cấp RSSI qua UART**; đo được đoạn đó thì phải đổi sang E22. Nói ra giới hạn của
phần cứng đúng hơn là bịa một con số.

---

## 2. Đường đi của lệnh

### Vì sao bảng này tồn tại

Câu hỏi hội đồng hay hỏi: *"Sao không gọi thẳng từ máy chủ xuống ESP32 cho nhanh?"*

**Vì không gọi được.** ESP32 nằm sau NAT của router — máy chủ không có đường mở
kết nối tới nó. Nên lệnh phải **nằm trong hàng đợi** cho tới khi ESP32 tự hỏi
(mỗi 3 giây một lần, hằng số `WEB_POLL_INTERVAL` trong firmware).

Bảng này cho thấy điều đó bằng số, không phải bằng lời.

### Ba đoạn màu

Mỗi lệnh là một dải ngang, bề rộng mỗi đoạn **tỉ lệ với thời gian thật**:

| Màu | Đoạn | Nghĩa |
|---|---|---|
| Tím | **Giữ lại có chủ ý** | Lệnh bị giữ theo lịch, chưa được phép chạy (`run_after`) |
| Vàng | **Chờ ESP32 hỏi tới** | Đã sẵn sàng, đang nằm đợi lượt hỏi |
| Xanh | **Phần cứng thực thi** | Từ lúc ESP32 nhận tới lúc rơ-le xác nhận xong |

Nhìn dải là thấy ngay: **phần lớn thời gian trôi ở đoạn CHỜ, không phải ở đoạn
phần cứng làm việc.** Phần cứng thường xong trong dưới 1 giây.

Rê chuột vào từng đoạn hiện con số của riêng đoạn đó.

### Đoạn tím — chỗ đáng khoe

Khi bấm **"Kiểm tra toàn dàn"**, hệ thống không bật 9 thiết bị cùng lúc mà giãn
mỗi cái **2 giây**, để tránh cú sụt điện do 5 bơm khởi động đồng thời.

Trên bảng, chín lệnh đó xếp thành thang: đoạn tím dài dần đều **0 → 2 → 4 → 6 →
8 → 10 → 12 → 14 → 16 giây**. Đó là bằng chứng nhìn thấy được của một quyết định
thiết kế, không phải một lời khai trong báo cáo.

### Các nhãn khác

- **thử lại ×N** — lệnh phải gửi lại vì lần trước ESP32 lấy đi mà không xác
  nhận. Chỉ hiện khi N > 1.
- **Hết hạn** — lệnh nằm trong hàng đợi quá lâu rồi bị bỏ (TTL, mặc định 300
  giây). Cố ý tồn tại: một lệnh "BẬT BƠM" bấm từ 10 phút trước mà giờ mới chạy
  thì nguy hiểm hơn là không chạy.
- **Thất bại** — ESP32 báo về là không thực thi được.
- **Trọn vòng thường** ở góc phải tiêu đề — trung vị thời gian trọn vòng của các
  lệnh đã xong.

### Cách diễn trước hội đồng

1. Sang trang **CONTROL**, bấm bật một van.
2. Quay lại **DASHBOARD**, cuộn xuống — lệnh vừa bấm nằm trên cùng, đủ ba đoạn.
3. Chỉ vào đoạn vàng: *"Đây là thời gian chờ ESP32 hỏi tới. Trung bình 1,5 giây,
   tối đa 3 giây, đúng bằng chu kỳ hỏi trong firmware."*
4. Bấm **"Kiểm tra toàn dàn"** rồi quay lại — chín dải tím xếp thành thang 2 giây.

---

## Số liệu tham chiếu

Đo trên bộ dữ liệu thử 28.360 dòng ở đúng nhịp thật của ESP32 (3 giây/dòng):

| Phép đo | Kết quả |
|---|---|
| `/api/telemetry/link?hours=24` | 130 ms |
| `/api/telemetry/link?hours=1` | 14 ms |
| Phát hiện khoảng trống | đúng 2/2 quãng đã gieo, dài nhất 18 phút |
| Nhịp trung vị nhận ra | 3 giây → ngưỡng 30 giây |

Trên phần cứng thật các con số sẽ khác — đây là số của đường ống, không phải số
của ngoài đồng.

---

## Câu hỏi hội đồng có thể hỏi

**"Sao không đo sóng LoRa?"**
Module E32 nối qua UART không có lệnh đọc RSSI. Đổi sang module dòng E22
(LLCC68/SX1262) thì đọc được — nhưng đó là đổi phần cứng.

**"Sao không hiện tỉ lệ mất gói?"**
Vì giao thức không đánh số thứ tự gói nên không đếm được. Muốn có con số đó phải
thêm một byte số thứ tự vào bản tin LoRa ở cả hai đầu — làm được, nhưng chưa
làm, và không công bố một con số mình không đo được.

**"RSSI −70 dBm có sao không?"**
Nằm trong dải trung bình, WiFi vẫn chạy tốt. Đáng lo là khi đường tụt xuống dưới
−75 dBm **và** ở đó lâu, hoặc khi số lần mất liên lạc tăng dần theo ngày.

**"Vì sao lệnh mất tới 3 giây mới tới?"**
Vì kiến trúc kéo (pull), do ESP32 nằm sau NAT. Đổi lại: ESP32 không cần IP tĩnh,
không cần mở cổng vào mạng nội bộ, và mất mạng thì nó vẫn tự chạy AUTO tại chỗ.
Muốn nhanh hơn thì rút ngắn chu kỳ hỏi, đánh đổi bằng lưu lượng và điện năng.

**"Số liệu này lưu bao lâu?"**
7 ngày (`TELEMETRY_RETENTION_DAYS`). Ở nhịp 3 giây là khoảng 201.600 dòng, chừng
20 MB — và đúng bằng khung dài nhất biểu đồ cho chọn.
