function fmtTime(iso) {
  if (!iso) return '--:--:--';
  // SQLite stores 'YYYY-MM-DD HH:MM:SS' in UTC
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('vi-VN', { hour12: false });
}

export function MetricCards({ latest }) {
  const cards = [
    {
      key: 'temperature',
      icon: '🌡️',
      label: 'NHIỆT ĐỘ',
      value: latest?.temperature,
      unit: '°C',
      cls: 'card-temp',
    },
    {
      key: 'humidity',
      icon: '💧',
      label: 'ĐỘ ẨM',
      value: latest?.humidity,
      unit: '%',
      cls: 'card-humidity',
    },
    {
      key: 'ph',
      icon: '⚗️',
      label: 'pH',
      value: latest?.ph,
      unit: '',
      cls: 'card-ph',
    },
    {
      key: 'ec',
      icon: '🧪',
      label: 'EC',
      value: latest?.ec,
      unit: 'mS/cm',
      cls: 'card-ec',
    },
  ];

  return (
    <section className="metric-cards">
      {cards.map((c) => (
        <div key={c.key} className={`metric-card ${c.cls}`}>
          <div className="metric-icon">{c.icon}</div>
          <div className="metric-body">
            <span className="metric-label">{c.label}</span>
            <span className="metric-value">
              {c.value ?? '--'} <small>{c.unit}</small>
            </span>
            <span className="metric-updated">
              Cập nhật: {fmtTime(latest?.created_at)}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}
