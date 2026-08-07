import {
  METRICS,
  SOIL_KEYS,
  fmtValue,
  metricStatus,
  statusReason,
  STATUS_COLOR,
  STATUS_ICON,
} from '../metrics.js';
import {
  IconTemperature,
  IconHumidity,
  IconPh,
  IconEc,
  IconNutrient,
} from './Icons.jsx';

const ICON = {
  temperature: IconTemperature,
  humidity: IconHumidity,
  ph: IconPh,
  ec: IconEc,
};

// The four headline soil readings, each on its own accent-bordered card.
// Out-of-range state is spelled out under the value, never colour alone.
function MetricCard({ metricKey, value, thresholds }) {
  const m = METRICS[metricKey];
  const Icon = ICON[metricKey];
  const state = metricStatus(metricKey, value, thresholds);
  const reason = statusReason(metricKey, value, thresholds);
  const alarm = state && state !== 'ok';

  return (
    <article className={`pcard${alarm ? ' pcard-alarm' : ''}`} style={{ '--accent': m.color }}>
      <div className="pcard-top">
        <span className="pcard-icon">
          <Icon size={46} />
        </span>
        <span className="pcard-titles">
          <strong>{m.label}</strong>
          <em>{m.en}</em>
        </span>
      </div>

      <div className="pcard-readout">
        <span className="pcard-value">{fmtValue(value, metricKey)}</span>
        <span className="pcard-unit">{m.unit}</span>
      </div>

      {alarm && (
        <p className="pcard-alarm-note" style={{ color: STATUS_COLOR[state] }}>
          {STATUS_ICON[state]} Ngoài ngưỡng ({reason})
        </p>
      )}
    </article>
  );
}

// Potassium and nitrogen share one card, as on the panel — those are the two
// the rig actually doses. Phosphorus is still recorded and charted below.
function NutrientCard({ latest, thresholds }) {
  const rows = [
    { key: 'k', min: 'kMin' },
    { key: 'n', min: 'nMin' },
  ];

  return (
    <article className="pcard pcard-wide" style={{ '--accent': METRICS.k.color }}>
      <div className="pcard-top">
        <span className="pcard-icon">
          <IconNutrient size={46} />
        </span>
        <span className="pcard-titles">
          <strong>Kali &amp; Đạm</strong>
          <em>Potassium &amp; Nitrogen</em>
        </span>
      </div>

      <div className="pcard-lines">
        {rows.map(({ key, min }) => {
          const m = METRICS[key];
          const value = latest?.[key];
          const state = metricStatus(key, value, thresholds);
          const low = state && state !== 'ok';
          return (
            <div key={key} className="pcard-line">
              <span className="pcard-line-label">{m.label}</span>
              <span
                className={`pcard-line-value${low ? ' is-low' : ''}`}
                title={low ? `Dưới ngưỡng ${thresholds?.[min]} ${m.unit}` : undefined}
              >
                {fmtValue(value, key)}
                {low && <i> {STATUS_ICON[state]}</i>}
              </span>
              <span className="pcard-line-unit">{m.unit}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function OverviewCards({ latest, thresholds }) {
  return (
    <section className="pcard-row pcard-row-metrics">
      {SOIL_KEYS.map((key) => (
        <MetricCard
          key={key}
          metricKey={key}
          value={latest?.[key]}
          thresholds={thresholds}
        />
      ))}
      <NutrientCard latest={latest} thresholds={thresholds} />
    </section>
  );
}
