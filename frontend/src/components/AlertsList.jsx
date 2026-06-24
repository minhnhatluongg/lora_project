function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('vi-VN', { hour12: false });
}

const ICON = { info: 'ℹ️', warning: '⚠️', danger: '🛑' };

export function AlertsList({ alerts }) {
  return (
    <div className="panel">
      <h3>Cảnh báo gần nhất</h3>
      <ul className="alert-list">
        {(alerts || []).map((a) => (
          <li key={a.id} className={`alert alert-${a.level}`}>
            <span className="alert-icon">{ICON[a.level] || 'ℹ️'}</span>
            <span className="alert-time">{fmt(a.created_at)}</span>
            <span className="alert-msg">{a.message}</span>
          </li>
        ))}
        {(!alerts || alerts.length === 0) && (
          <li className="empty">Không có cảnh báo</li>
        )}
      </ul>
    </div>
  );
}
