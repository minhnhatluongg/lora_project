import { useState } from 'react';
import { tokenStore } from '../api.js';
import { IconDownload, IconWarning } from './Icons.jsx';

// Ba khoảng, đúng ba nút của biểu đồ ngay phía trên. Không thêm mốc "toàn bộ":
// dữ liệu chỉ giữ 7 ngày, nên "7 ngày" đã là tất cả những gì có.
const RANGES = [
  { key: '1h', label: '1 giờ', hint: 'dữ liệu thô' },
  { key: '24h', label: '24 giờ', hint: 'dữ liệu thô' },
  // Ô gộp do máy chủ chọn theo lượng dữ liệu thật, nên đừng hứa một con số cụ
  // thể ở đây: trang Tổng quan trong file ghi rõ đã gộp bao nhiêu giây.
  { key: '7d', label: '7 ngày', hint: 'gộp tự động' },
];

export function ExportPanel() {
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  // Không dùng thẻ <a href> được: endpoint đòi header Authorization, mà thẻ neo
  // thì không gắn header. Nên tải bằng fetch rồi dựng blob.
  async function download(key) {
    setBusy(key);
    setErr(null);
    let url = null;
    try {
      const res = await fetch(`/api/telemetry/export?range=${key}`, {
        headers: { Authorization: `Bearer ${tokenStore.get()}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status} ${res.statusText}`);
      }
      // Lấy tên file máy chủ đặt; hỏng thì tự đặt, đừng để rơi ra "download".
      const cd = res.headers.get('Content-Disposition') || '';
      const match = /filename="?([^"]+)"?/.exec(cd);
      const blob = await res.blob();
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match ? match[1] : `smartfarm-${key}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setErr(e.message);
    } finally {
      // Thu hồi trễ một nhịp: thu ngay thì trình duyệt có thể chưa kịp đọc xong
      // blob và file tải về rỗng.
      if (url) setTimeout(() => URL.revokeObjectURL(url), 4000);
      setBusy(null);
    }
  }

  return (
    <div className="panel exp-panel">
      <div className="exp-head">
        <span className="exp-icon">
          <IconDownload size={18} />
        </span>
        <h3>Xuất báo cáo Excel</h3>
      </div>

      <p className="exp-desc">
        Một file <strong>.xlsx</strong> gồm bốn trang: <em>Tổng quan</em> (thống kê từng chỉ số kèm
        số lần vượt ngưỡng), <em>Dữ liệu đo</em>, <em>Cảnh báo</em> và <em>Nhật ký lệnh</em>. Mọi
        cột thời gian đã đổi sang giờ Việt Nam.
      </p>

      <div className="exp-btns">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            className="exp-btn"
            onClick={() => download(r.key)}
            disabled={busy !== null}
          >
            <span className="exp-btn-label">{busy === r.key ? 'Đang tạo…' : r.label}</span>
            <span className="exp-btn-hint">{r.hint}</span>
          </button>
        ))}
      </div>

      {err && (
        <p className="exp-err" role="alert">
          <IconWarning size={16} /> Không xuất được: {err}
        </p>
      )}
    </div>
  );
}
