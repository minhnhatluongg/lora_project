import {
  METRICS,
  SOIL_KEYS,
  fmtValue,
  fmtTime,
  metricStatus,
  statusReason,
  STATUS_COLOR,
  STATUS_ICON,
} from '../metrics.js';
import { Sparkline } from './Sparkline.jsx';

// The four headline soil readings from the RS485 probe, each with the trend of
// the current window. Out-of-range state carries an icon + words, not just colour.
export function MetricCards({ latest, history, thresholds }) {
  return (
    <section className="metric-cards">
      {SOIL_KEYS.map((key) => {
        const m = METRICS[key];
        const value = latest?.[key];
        const state = metricStatus(key, value, thresholds);
        const reason = statusReason(key, value, thresholds);
        const trend = (history || []).map((r) => r[key]);

        return (
          <article key={key} className={`metric-card${state && state !== 'ok' ? ' metric-alarm' : ''}`}>
            <div className="metric-top">
              <span className="metric-icon" style={{ background: `${m.color}22`, color: m.color }}>
                {m.icon}
              </span>
              <span className="metric-label">{m.label.toUpperCase()}</span>
            </div>

            <div className="metric-value">
              {fmtValue(value, key)}
              {m.unit && <small>{m.unit}</small>}
            </div>

            <div className="metric-foot">
              {state && state !== 'ok' ? (
                <span className="metric-state" style={{ color: STATUS_COLOR[state] }}>
                  {STATUS_ICON[state]} Ngoài ngưỡng ({reason})
                </span>
              ) : (
                <span className="metric-updated">Cập nhật {fmtTime(latest?.created_at)}</span>
              )}
              <Sparkline values={trend} color={m.color} />
            </div>
          </article>
        );
      })}
    </section>
  );
}
