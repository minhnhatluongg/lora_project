import { STATUS_COLOR, SENSOR_STATUS_TEXT } from '../metrics.js';
import { TimeAgo } from './TimeAgo.jsx';

function Row({ label, children }) {
  return (
    <div className="status-row">
      <span>{label}</span>
      {children}
    </div>
  );
}

// Ba trạng thái, không phải hai. `null` nghĩa là KHÔNG RÕ — master im tiếng thì
// ta không có tin gì về node cảm biến, và đoán bừa một trong hai đầu đều là nói
// dối. Chữ mang nghĩa, màu chỉ nhấn thêm.
function Badge({ ok, children }) {
  const cls = ok === null ? 'badge-unknown' : ok ? 'badge-on' : 'badge-off';
  return <span className={`badge ${cls}`}>{children}</span>;
}

// Ngưỡng của WiFi (ESP32 ↔ router), KHÁC hẳn LoRa: LoRa thu tới −120 dBm vẫn
// giải mã tốt nhờ trải phổ, còn WiFi dưới −75 dBm là đã rớt gói thấy rõ.
function rssiQuality(rssi) {
  if (rssi == null) return null;
  if (rssi > -60) return { text: 'Tốt', level: 'ok' };
  if (rssi > -75) return { text: 'Trung bình', level: 'warn' };
  return { text: 'Yếu', level: 'crit' };
}

export function StatusPanel({ status, latest, connected }) {
  const s = status || {};
  const rssi = rssiQuality(latest?.wifi_rssi);
  const sensor = s.sensorStatus ? SENSOR_STATUS_TEXT[s.sensorStatus] : null;

  return (
    <div className="panel">
      <h3>Trạng thái hệ thống</h3>

      <Row label="ESP32 Master">
        <Badge ok={s.masterOnline}>{s.masterOnline ? 'ONLINE' : 'OFFLINE'}</Badge>
      </Row>
      <Row label="Node cảm biến (Slave)">
        <Badge ok={s.slaveOnline}>
          {s.slaveOnline === null ? 'CHƯA RÕ' : s.slaveOnline ? 'ONLINE' : 'OFFLINE'}
        </Badge>
      </Row>

      <Row label="Đường Modbus RS485">
        {sensor ? (
          <span
            className="status-value"
            style={{ color: s.sensorStale ? undefined : STATUS_COLOR[sensor.level] }}
          >
            {/* Trạng thái cũ thì phải NÓI là cũ. "Đọc tốt" của 5 giờ trước
                không phải tin tức về hiện tại. */}
            {s.sensorStale ? `${sensor.text} (số liệu cũ)` : sensor.text}
          </span>
        ) : (
          <span className="status-value">Chưa có báo cáo</span>
        )}
      </Row>

      <Row label="Sóng WiFi (ESP32 ↔ router)">
        <span className="status-value">
          {latest?.wifi_rssi != null ? `${latest.wifi_rssi} dBm` : '--'}
          {rssi && <em style={{ color: STATUS_COLOR[rssi.level] }}> · {rssi.text}</em>}
        </span>
      </Row>

      <Row label="Dữ liệu gần nhất">
        <TimeAgo iso={latest?.created_at} className="status-value" />
      </Row>

      <Row label="Chế độ hoạt động">
        <span className="badge badge-mode">{s.mode || '--'}</span>
      </Row>

      {/* Dòng này KHÔNG nói về phần cứng ngoài đồng — nó là đường giữa trình
          duyệt này và máy chủ. Đặt chung danh sách với ESP32/Slave mà chỉ ghi
          "Kênh realtime" thì người đọc tưởng đây là thiết bị thứ ba, và thấy
          "ĐANG KẾT NỐI" trong lúc cả tủ đã tắt. Tách hẳn ra và ghi rõ hai đầu. */}
      <div className="status-sep" />
      <Row label="Trình duyệt ↔ máy chủ">
        <Badge ok={connected}>{connected ? 'ĐANG KẾT NỐI' : 'MẤT KẾT NỐI'}</Badge>
      </Row>
    </div>
  );
}
