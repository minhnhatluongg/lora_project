import {
  METRICS,
  NPK_KEYS,
  fmtValue,
  metricStatus,
  STATUS_COLOR,
  STATUS_ICON,
} from '../metrics.js';

const MIN_KEY = { n: 'nMin', p: 'pMin', k: 'kMin' };

// NPK are three magnitudes on one common scale (ppm), so they read as bars
// against a shared axis with the configured minimum drawn as a reference line.
export function NpkPanel({ latest, thresholds }) {
  const values = NPK_KEYS.map((k) => latest?.[k]).filter((v) => v != null);
  const mins = thresholds ? NPK_KEYS.map((k) => thresholds[MIN_KEY[k]]) : [];
  const scaleMax = Math.max(1, ...values, ...mins) * 1.15;

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Dinh dưỡng đất (NPK)</h3>
        <span className="panel-sub">ppm</span>
      </div>

      <div className="npk-list">
        {NPK_KEYS.map((key) => {
          const m = METRICS[key];
          const value = latest?.[key];
          const min = thresholds?.[MIN_KEY[key]];
          const state = metricStatus(key, value, thresholds);
          const pct = value == null ? 0 : (value / scaleMax) * 100;
          const minPct = min == null ? null : (min / scaleMax) * 100;

          return (
            <div key={key} className="npk-row">
              <span className="npk-name">
                {m.icon} {m.label}
              </span>

              <div className="npk-track">
                <div
                  className="npk-fill"
                  style={{ width: `${pct}%`, background: m.color }}
                />
                {minPct != null && (
                  <span
                    className="npk-min"
                    style={{ left: `${minPct}%` }}
                    title={`Ngưỡng tối thiểu: ${min} ppm`}
                  />
                )}
              </div>

              <span className="npk-value">
                {fmtValue(value, key)}
                {state && state !== 'ok' && (
                  <em style={{ color: STATUS_COLOR[state] }}>
                    {' '}{STATUS_ICON[state]} thiếu
                  </em>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <p className="hint">
        Vạch đứng mờ là ngưỡng tối thiểu đặt trong <strong>Cài đặt &amp; Tự động</strong>.
      </p>
    </div>
  );
}
