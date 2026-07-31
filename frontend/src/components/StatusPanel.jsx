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

function Badge({ ok, children }) {
  return <span className={`badge ${ok ? 'badge-on' : 'badge-off'}`}>{children}</span>;
}

// LoRa RSSI is roughly: > -70 strong, -70..-90 usable, < -90 marginal.
function rssiQuality(rssi) {
  if (rssi == null) return null;
  if (rssi > -70) return { text: 'Tốt', level: 'ok' };
  if (rssi > -90) return { text: 'Trung bình', level: 'warn' };
  return { text: 'Yếu', level: 'crit' };
}

export function StatusPanel({ status, latest, connected }) {
  const s = status || {};
  const rssi = rssiQuality(s.loraRssi);
  const sensor = s.sensorStatus ? SENSOR_STATUS_TEXT[s.sensorStatus] : null;

  return (
    <div className="panel">
      <h3>Trạng thái hệ thống</h3>

      <Row label="ESP32 Master">
        <Badge ok={s.masterOnline}>{s.masterOnline ? 'ONLINE' : 'OFFLINE'}</Badge>
      </Row>
      <Row label="Node cảm biến (Slave)">
        <Badge ok={s.slaveOnline}>{s.slaveOnline ? 'ONLINE' : 'OFFLINE'}</Badge>
      </Row>

      <Row label="Đường Modbus RS485">
        {sensor ? (
          <span className="status-value" style={{ color: STATUS_COLOR[sensor.level] }}>
            {sensor.text}
          </span>
        ) : (
          <span className="status-value">Chưa có báo cáo</span>
        )}
      </Row>

      <Row label="LoRa RSSI">
        <span className="status-value">
          {s.loraRssi != null ? `${s.loraRssi} dBm` : '--'}
          {rssi && (
            <em style={{ color: STATUS_COLOR[rssi.level] }}> · {rssi.text}</em>
          )}
        </span>
      </Row>

      <Row label="Dữ liệu gần nhất">
        <TimeAgo iso={latest?.created_at} className="status-value" />
      </Row>

      <Row label="Kênh realtime">
        <Badge ok={connected}>{connected ? 'ĐANG KẾT NỐI' : 'MẤT KẾT NỐI'}</Badge>
      </Row>

      <Row label="Chế độ hoạt động">
        <span className="badge badge-mode">{s.mode || '--'}</span>
      </Row>
    </div>
  );
}
