import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { socket, EVENTS } from '../socket.js';
import { DEVICE_LABEL } from '../metrics.js';
import { IconClock, IconWarning, IconCheck } from './Icons.jsx';
import './Diagnostics.css';

// Dòng đời của một lệnh, từ lúc bấm nút tới lúc rơ-le xác nhận.
//
// Bảng `commands` xưa nay ghi đủ bốn mốc thời gian nhưng không màn hình nào đọc
// tới. Đó chính là chỗ giải thích vì sao hệ này dùng HÀNG ĐỢI chứ không gọi
// thẳng xuống ESP32: ESP32 nằm sau NAT, máy chủ không mở kết nối tới nó được,
// nên lệnh phải nằm chờ đến lượt ESP32 hỏi (mỗi 3 giây một lần).

const STATUS = {
  pending: { label: 'Đang chờ', cls: 'is-pending' },
  sent: { label: 'Đã gửi', cls: 'is-sent' },
  acked: { label: 'Xong', cls: 'is-acked' },
  failed: { label: 'Thất bại', cls: 'is-failed' },
  // 'Hết hạn' chứ không phải 'Quá hạn': bên trang CÔNG VIỆC 'Quá hạn' nghĩa là
  // trễ hạn chót. Ở đây là lệnh nằm trong hàng đợi quá lâu rồi bị bỏ (TTL).
  expired: { label: 'Hết hạn', cls: 'is-failed' },
  cancelled: { label: 'Đã huỷ', cls: 'is-failed' },
};

const ACTION_LABEL = { ON: 'BẬT', OFF: 'TẮT', AUTO: 'TỰ ĐỘNG', MANUAL: 'THỦ CÔNG' };

const deviceName = (id) => DEVICE_LABEL?.[id] || (id === 'mode' ? 'Chế độ' : id === 'system' ? 'Hệ thống' : id);

const secs = (s) => (s == null ? null : s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`);

const clock = (sqlish) => {
  if (!sqlish) return '--';
  const d = new Date(sqlish.replace(' ', 'T') + 'Z');
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// Một lệnh = một dải ngang chia ba đoạn. Bề rộng mỗi đoạn tỉ lệ với thời gian
// thật của nó, nên nhìn là thấy ngay phần lớn thời gian trôi ở đâu — thường là
// ở đoạn CHỜ, không phải ở đoạn phần cứng làm việc.
function Bar({ cmd }) {
  const hold = cmd.holdSeconds || 0;
  const wait = Math.max((cmd.waitSeconds ?? 0) - hold, 0);
  const run = cmd.runSeconds ?? 0;
  const total = hold + wait + run;
  if (!total) return null;

  const pct = (v) => `${(v / total) * 100}%`;
  return (
    <div className="cmd-bar" role="img" aria-label={`Giữ ${hold}s, chờ ${wait}s, thực thi ${run}s`}>
      {hold > 0 && (
        <span className="cmd-seg cmd-seg-hold" style={{ width: pct(hold) }} title={`Giữ lại có chủ ý: ${secs(hold)}`} />
      )}
      {wait > 0 && (
        <span className="cmd-seg cmd-seg-wait" style={{ width: pct(wait) }} title={`Chờ ESP32 hỏi tới: ${secs(wait)}`} />
      )}
      {run > 0 && (
        <span className="cmd-seg cmd-seg-run" style={{ width: pct(run) }} title={`Phần cứng thực thi: ${secs(run)}`} />
      )}
    </div>
  );
}

export function CommandTimeline() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.recentCommands(20).then(
      (r) => { setRows(r); setErr(''); },
      (e) => setErr(e.message || 'Không tải được nhật ký lệnh.')
    );
  }, []);

  useEffect(() => { load(); }, [load]);

  // Trạng thái thiết bị đổi nghĩa là vừa có lệnh chạy xong — đúng lúc để đọc lại.
  useEffect(() => {
    const onChange = () => load();
    socket.on(EVENTS.DEVICES, onChange);
    socket.on(EVENTS.STATUS, onChange);
    return () => {
      socket.off(EVENTS.DEVICES, onChange);
      socket.off(EVENTS.STATUS, onChange);
    };
  }, [load]);

  const done = rows.filter((r) => r.totalSeconds != null);
  const median = done.length
    ? [...done].map((r) => r.totalSeconds).sort((a, b) => a - b)[Math.floor(done.length / 2)]
    : null;

  return (
    <div className="panel diag-panel">
      <div className="panel-head">
        <h3>
          <IconClock size={17} />
          Đường đi của lệnh
        </h3>
        {median != null && (
          <span className="diag-headline">
            Trọn vòng thường: <strong>{secs(median)}</strong>
          </span>
        )}
      </div>

      <p className="diag-note">
        ESP32 nằm sau NAT nên máy chủ không gọi xuống được — lệnh phải xếp hàng đợi tới lượt nó
        hỏi. Dải màu cho thấy thời gian trôi ở đâu.
      </p>

      <div className="cmd-legend">
        <span><i className="cmd-key cmd-seg-hold" />Giữ lại có chủ ý</span>
        <span><i className="cmd-key cmd-seg-wait" />Chờ ESP32 hỏi tới</span>
        <span><i className="cmd-key cmd-seg-run" />Phần cứng thực thi</span>
      </div>

      {err && (
        <p className="diag-msg is-bad" role="alert">
          <IconWarning size={15} />
          {err}
        </p>
      )}

      {rows.length === 0 && !err ? (
        <p className="diag-empty">Chưa có lệnh nào được gửi.</p>
      ) : (
        <ul className="cmd-list">
          {rows.map((c) => {
            const st = STATUS[c.status] || { label: c.status, cls: '' };
            return (
              <li key={c.id} className={`cmd-row ${st.cls}`}>
                <div className="cmd-head">
                  <span className="cmd-what">
                    <strong>{deviceName(c.deviceId)}</strong>
                    <em>{ACTION_LABEL[c.action] || c.action}</em>
                  </span>
                  <span className="cmd-time">{clock(c.createdAt)}</span>
                  <span className={`cmd-status ${st.cls}`}>
                    {c.status === 'acked' && <IconCheck size={12} />}
                    {st.label}
                  </span>
                  {/* Số lần thử chỉ hiện khi LỚN HƠN 1: "đã thử 1 lần" là điều
                      hiển nhiên, in ra chỉ làm loãng những dòng thật sự phải
                      thử lại. */}
                  {c.attempts > 1 && (
                    <span className="cmd-retry" title="Số lần phải gửi lại vì không nhận được xác nhận">
                      thử lại ×{c.attempts}
                    </span>
                  )}
                </div>

                <Bar cmd={c} />

                <div className="cmd-steps">
                  {c.holdSeconds > 0 && (
                    <span><b>Giữ</b> {secs(c.holdSeconds)}</span>
                  )}
                  <span>
                    {/* Chưa gửi đi thì chưa có gì để đo — in "0.0s" ở đây là
                        khẳng định lệnh đã tới ESP32 tức thì, trong khi thật ra
                        nó còn đang nằm trong hàng đợi. */}
                    <b>Chờ</b>{' '}
                    {c.sentAt
                      ? secs(Math.max((c.waitSeconds ?? 0) - (c.holdSeconds || 0), 0))
                      : 'chưa gửi'}
                  </span>
                  <span><b>Thực thi</b> {secs(c.runSeconds) ?? '--'}</span>
                  <span className="cmd-total"><b>Trọn vòng</b> {secs(c.totalSeconds) ?? 'chưa xong'}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default CommandTimeline;
