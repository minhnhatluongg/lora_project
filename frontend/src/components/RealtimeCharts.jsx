import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  METRICS,
  SOIL_KEYS,
  NPK_KEYS,
  AIR_KEYS,
  LEVEL_KEYS,
  displayValue,
  fmtShortTime,
  fmtDateTime,
} from '../metrics.js';
import { RANGES } from '../useFarm.js';

const TABS = [
  { id: 'soil', label: 'Môi trường đất', keys: SOIL_KEYS, mode: 'small-multiples' },
  { id: 'npk', label: 'Dinh dưỡng NPK', keys: NPK_KEYS, mode: 'combined', unit: 'ppm' },
  // °C, %RH and % don't share a scale, so these get one plot each.
  { id: 'air', label: 'Không khí & mưa', keys: [...AIR_KEYS, 'rain'], mode: 'small-multiples' },
  { id: 'water', label: 'Mực nước bồn', keys: LEVEL_KEYS, mode: 'combined', unit: '%', domain: [0, 100] },
];

// Every key this component can plot. Rows arrive in STORAGE units (EC in µS/cm)
// but the axes are titled from METRICS[key].unit, which is what the panel shows
// (EC in mS/cm) — so the numbers have to be converted before they reach recharts
// or the EC axis reads ~1480 under a "mS/cm" label.
const PLOT_KEYS = [...new Set(TABS.flatMap((t) => t.keys))];

// Recessive grid/axis on the white chart surface — the data should carry the ink.
const GRID = '#e6ebf2';
const AXIS_INK = '#64748b';

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-time">{fmtDateTime(label)}</div>
      {payload.map((row) => {
        const m = METRICS[row.dataKey];
        // Values are already in display units here; only the rounding is left.
        const shown =
          row.value == null || Number.isNaN(Number(row.value))
            ? '--'
            : Number(row.value).toFixed(m?.decimals ?? 1);
        return (
          <div key={row.dataKey} className="chart-tooltip-row">
            <span className="chart-swatch" style={{ background: row.color }} />
            <span className="chart-tooltip-name">{m?.short || row.dataKey}</span>
            <span className="chart-tooltip-value">
              {shown}
              {shown !== '--' && m?.unit ? ` ${m.unit}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const axisProps = {
  tick: { fontSize: 10, fill: AXIS_INK },
  tickLine: false,
  axisLine: { stroke: GRID },
};

export function RealtimeCharts({ history, hours, onHoursChange }) {
  const [tab, setTab] = useState('soil');
  const active = TABS.find((t) => t.id === tab);
  const data = useMemo(() => {
    const rows = history || [];
    return rows.map((row) => {
      const out = { ...row };
      for (const key of PLOT_KEYS) out[key] = displayValue(row[key], key);
      return out;
    });
  }, [history]);
  const empty = data.length === 0;

  return (
    <div className="panel">
      <div className="panel-head chart-head">
        <h3>Biểu đồ theo thời gian</h3>
        <div className="chart-controls">
          <div className="seg">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`seg-btn ${tab === t.id ? 'seg-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="seg">
            {RANGES.map((r) => (
              <button
                key={r.hours}
                className={`seg-btn ${hours === r.hours ? 'seg-active' : ''}`}
                onClick={() => onHoursChange(r.hours)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {empty && <p className="empty">Chưa có dữ liệu trong khoảng thời gian này.</p>}

      {!empty && active.mode === 'small-multiples' && (
        // Four different units — never one plot with two scales. One chart each,
        // titled, so a single series needs no legend.
        <div className="charts-grid">
          {active.keys.map((key) => {
            const m = METRICS[key];
            return (
              <div key={key} className="mini-chart">
                <span className="mini-chart-title">
                  {m.label}
                  {m.unit && <em> ({m.unit})</em>}
                </span>
                <ResponsiveContainer width="100%" height={130}>
                  <LineChart data={data} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                    <XAxis
                      dataKey="created_at"
                      tickFormatter={fmtShortTime}
                      minTickGap={36}
                      {...axisProps}
                    />
                    <YAxis domain={['auto', 'auto']} width={44} {...axisProps} />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#94a3b8', strokeWidth: 1 }} />
                    <Line
                      type="monotone"
                      dataKey={key}
                      stroke={m.color}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      )}

      {!empty && active.mode === 'combined' && (
        // Same unit across series, so they share one axis and one legend.
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis
              dataKey="created_at"
              tickFormatter={fmtShortTime}
              minTickGap={44}
              {...axisProps}
            />
            <YAxis
              domain={active.domain || ['auto', 'auto']}
              width={52}
              label={{
                value: active.unit,
                angle: -90,
                position: 'insideLeft',
                fill: AXIS_INK,
                fontSize: 11,
              }}
              {...axisProps}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#94a3b8', strokeWidth: 1 }} />
            <Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: 12, color: '#64748b', paddingTop: 8 }}
              formatter={(key) => METRICS[key]?.label || key}
            />
            {active.keys.map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={key}
                stroke={METRICS[key].color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
