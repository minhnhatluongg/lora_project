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

export function StatusPanel({ status }) {
  const s = status || {};
  return (
    <div className="panel">
      <h3>Trạng thái hệ thống</h3>
      <Row label="Master">
        <Badge ok={s.masterOnline}>{s.masterOnline ? 'ONLINE' : 'OFFLINE'}</Badge>
      </Row>
      <Row label="Slave">
        <Badge ok={s.slaveOnline}>{s.slaveOnline ? 'ONLINE' : 'OFFLINE'}</Badge>
      </Row>
      <Row label="LoRa RSSI">
        <span className="status-value">
          {s.loraRssi != null ? `${s.loraRssi} dBm` : '--'}
        </span>
      </Row>
      <Row label="Chế độ hoạt động">
        <span className="badge badge-mode">{s.mode || '--'}</span>
      </Row>
    </div>
  );
}
