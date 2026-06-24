import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

const SERIES = [
  { key: 'temperature', label: 'Nhiệt độ (°C)', color: '#ef4444' },
  { key: 'humidity', label: 'Độ ẩm (%)', color: '#22c55e' },
  { key: 'ph', label: 'pH', color: '#a855f7' },
  { key: 'ec', label: 'EC (mS/cm)', color: '#f59e0b' },
];

function label(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function RealtimeCharts({ history }) {
  const data = (history || []).map((r) => ({ ...r, t: label(r.created_at) }));

  return (
    <div className="panel">
      <h3>Biểu đồ thời gian thực (24 giờ qua)</h3>
      <div className="charts-grid">
        {SERIES.map((s) => (
          <div key={s.key} className="mini-chart">
            <span className="mini-chart-title">{s.label}</span>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={data} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={30} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </div>
  );
}
