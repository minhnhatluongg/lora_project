# 🖥️ Cần sửa gì trên màn hình Nextion

Firmware ESP32 vừa đổi **đơn vị ngưỡng EC**. Màn Nextion phải sửa theo, nếu
không người vận hành sẽ nhìn thấy số không hiểu được — hoặc tệ hơn, **gõ vào
không đủ chỗ**.

File `.HMI` không nằm trong repo (chỉ nhóm phần cứng có), nên tài liệu này ghi
chính xác phải sửa ô nào.

---

## 1. Vì sao phải đổi

Đầu dò RS485 trả về EC theo **µS/cm** — số cỡ **1500**. Nhưng ngưỡng trong
firmware trước đây mặc định `1.0` và `2.0`, tức là **mS/cm**. Hai đơn vị lệch
nhau **1000 lần** mà lại đem so trực tiếp:

```cpp
if (EC_Value > ecMax)     //  1500 > 2.0  ->  LUÔN ĐÚNG
```

Hậu quả: máy pha phân kẹt vĩnh viễn ở bước *"EC quá cao, châm thêm nước"*,
không bao giờ bật `isMixingReady`, nên **tưới tự động không bao giờ khởi động**.

Đã sửa firmware sang **µS/cm** cho khớp đầu dò và khớp backend. Giá trị nông học
giữ nguyên, chỉ đổi cách viết:

| | Trước | Sau |
|---|---|---|
| EC tối thiểu | `1.0` mS/cm | **`1000.0`** µS/cm |
| EC tối đa | `2.0` mS/cm | **`2000.0`** µS/cm |

---

## 2. ⚠️ Việc BẮT BUỘC — nới độ dài ô nhập

Đây là chỗ dễ hỏng nhất và **phải kiểm trước tiên**.

Số hiển thị dài ra từ 3 ký tự (`1.0`) thành 6 ký tự (`1000.0`). Ô text trên
Nextion có thuộc tính **`txt_maxl`** (max text length). Nếu ô đang đặt
`txt_maxl` nhỏ (thường mặc định 10, nhưng nhiều người chỉnh xuống 4–5 cho gọn)
thì chuỗi sẽ **bị cắt cụt**, ví dụ `1000.0` thành `1000` hoặc `100`.

Bị cắt thì ESP32 đọc lại sai số → ngưỡng sai → máy pha phân chạy sai.

**Cần làm:** mở Nextion Editor, chọn hai ô ở bảng dưới, đặt `txt_maxl` **≥ 8**.

Nhớ chỉnh cả ô nhập trên **trang bàn phím số** (nếu thiết kế có trang keyboard
riêng để gõ số rồi trả về).

---

## 3. Hai ô cần sửa nhãn đơn vị

Trên **trang SETTINGS**:

| Ô Nextion | Nội dung | Nhãn cũ | Nhãn mới |
|---|---|---|---|
| **`t2`** | EC tối thiểu | `mS/cm` | **`µS/cm`** |
| **`t3`** | EC tối đa | `mS/cm` | **`µS/cm`** |

> Nếu font trên màn không có ký tự `µ` thì viết **`uS/cm`** — đừng để nguyên
> `mS/cm`, vì đó là thông tin sai.

Tám ô còn lại trên trang SETTINGS **không đổi gì**:

| Ô | Nội dung | Đơn vị |
|---|---|---|
| `t0` / `t1` | pH tối thiểu / tối đa | (không có) |
| `t4` / `t5` | Nhiệt độ tối thiểu / tối đa | °C |
| `t6` / `t7` | Độ ẩm đất tối thiểu / tối đa | % |
| `t8` / `t9` | Thời gian bơm / nghỉ | phút |

---

## 4. Trang DASHBOARD — kiểm tra lại nhãn

Trang dashboard hiển thị EC **đo được** ở ô `t3`:

```cpp
sendText("t3.txt", String(EC_Value));   // EC_Value là µS/cm, thô từ đầu dò
```

Ô này **xưa nay vẫn luôn là µS/cm**, firmware không đổi gì. Nhưng nếu nhãn cạnh
nó đang ghi `mS/cm` thì **nó đã sai từ đầu** — nhân dịp này sửa luôn.

> Lưu ý tên ô trùng nhau giữa các trang: `t2`/`t3` trên trang DASHBOARD là pH và
> EC **đo được**, còn `t2`/`t3` trên trang SETTINGS là ngưỡng EC min/max. Firmware
> gửi không kèm tên trang nên Nextion áp vào trang đang mở. **Đừng sửa nhầm trang.**

---

## 5. Không phải sửa gì thêm

Người vận hành **vẫn gõ được số cũ**. Firmware có hàm quy đổi ở cửa vào:

```cpp
float ecToMicro(float v) {
  return (v > 0.0 && v < 50.0) ? v * 1000.0 : v;
}
```

Nên gõ `1.5` (quen tay mS/cm) hay `1500` đều ra **1500 µS/cm**. Không có dung
dịch tưới thật nào chỉ 50 µS/cm — xấp xỉ nước cất — nên dưới ngưỡng đó chắc chắn
là đang nói mS/cm.

Cũng vì vậy mà **chip đã nạp firmware cũ không cần xóa Flash**: giá trị `1.0`
còn nằm trong bộ nhớ sẽ tự được quy đổi thành `1000` khi khởi động.

---

## 6. Kiểm tra sau khi sửa

| Bước | Kết quả đúng |
|---|---|
| 1. Nạp firmware mới, mở trang SETTINGS | `t2` hiện **`1000.0`**, `t3` hiện **`2000.0`** — không bị cắt cụt |
| 2. Gõ `1200` vào `t2`, `1800` vào `t3`, bấm Lưu | Serial in `>> [SETTINGS] Đã lưu ngưỡng vào Flash` |
| 3. **Tắt nguồn, bật lại**, vào SETTINGS | Vẫn là `1200.0` / `1800.0` — **không quay về mặc định** |
| 4. Thử gõ `1.5` rồi Lưu, khởi động lại | Hiện `1500.0` — hàm quy đổi chạy đúng |
| 5. Bấm Khôi phục gốc (`CMD=RESTORE`) | Về `1000.0` / `2000.0` |
| 6. Mở dashboard web → CÀI ĐẶT | EC min/max khớp số vừa gõ trên Nextion |

Bước 3 quan trọng nhất — trước đây `preferences.end()` bị gọi sớm nên ngưỡng lưu
xong **không bao giờ đọc lại được**, cứ khởi động là về mặc định. Đã sửa, và
bước này chính là để nghiệm thu điều đó.

Bước 6 kiểm cầu nối mới: ESP32 đẩy ngưỡng lên `POST /api/config/thresholds`,
backend lưu vào `thresholds.ecMin` / `ecMax` cùng đơn vị µS/cm.

---

## 7. Muốn đổi con số nông học

Sửa **đúng 2 dòng** đầu `firmware/esp32_master/esp32_master.ino`, mọi chỗ khác
tự theo (giá trị mặc định, khôi phục gốc, ô hiển thị, gói `SET_DATA`):

```cpp
const float EC_MIN_DEFAULT = 1000.0;  // = 1.0 mS/cm
const float EC_MAX_DEFAULT = 2000.0;  // = 2.0 mS/cm
```

Nhớ ghi bằng **µS/cm** (1200, 1800…), không phải mS/cm.

---

## Tài liệu liên quan

| File | Nội dung |
|---|---|
| [HUONG-DAN-CONTROL.md](HUONG-DAN-CONTROL.md) | Luồng CONTROL, ngưỡng và luật tự động |
| [firmware/README.md](firmware/README.md) | Chi tiết 3 board |
| [LUU-Y.md](LUU-Y.md) | Lỗi hay gặp khi cài trên máy mới |
