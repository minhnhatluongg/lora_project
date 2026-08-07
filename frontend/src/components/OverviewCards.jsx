import {
  METRICS,
  SOIL_KEYS,
  fmtValue,
  metricStatus,
  statusReason,
  STATUS_COLOR,
  STATUS_ICON,
} from '../metrics.js';
import { IconTemperature, IconHumidity, IconPh, IconEc } from './Icons.jsx';

const ICON = {
  temperature: IconTemperature,
  humidity: IconHumidity,
  ph: IconPh,
  ec: IconEc,
};

// Card titles are shouted in the panel design, but "pH" is a unit name — the
// uppercase rule would turn it into the meaningless "PH", so it opts out.
const KEEP_CASE = new Set(['ph']);

// One headline reading: big line glyph on the left, the Vietnamese name above
// the English one, and the value in the bottom-right corner with its unit.
// Pass no `icon` to get the centred, glyph-less variant the air cards use.
// Values always go through fmtValue(), so EC arrives in µS/cm and is drawn in
// mS/cm without this component knowing anything about the conversion.
export function MetricCard({ metricKey, value, thresholds, icon: Icon, accent }) {
  const m = METRICS[metricKey];
  const state = metricStatus(metricKey, value, thresholds);
  const alarm = state && state !== 'ok';

  const classes = ['dash-card', 'dash-card-value'];
  if (!Icon) classes.push('dash-card-centred');
  if (alarm) classes.push('dash-card-alarm');

  return (
    <article className={classes.join(' ')} style={{ '--dash-accent': accent || m.color }}>
      <div className="dash-head">
        {Icon && (
          <span className="dash-head-icon">
            <Icon size={72} />
          </span>
        )}
        <div className="dash-titles">
          <strong className={`dash-title${KEEP_CASE.has(metricKey) ? ' dash-title-ascase' : ''}`}>
            {m.label}
          </strong>
          <em className="dash-en">{m.en}</em>
        </div>
      </div>

      <div className="dash-readout">
        <span className="dash-value">{fmtValue(value, metricKey)}</span>
        <span className="dash-unit">{m.unit}</span>
      </div>

      {/* Out of range is spelled out — a mark, the words and the bound that was
          breached — so the state never rests on the accent colour alone. */}
      {alarm && (
        <p className="dash-alarm" style={{ color: STATUS_COLOR[state] }}>
          <span className="dash-mark" style={{ background: STATUS_COLOR[state] }} aria-hidden="true">
            {STATUS_ICON[state]}
          </span>
          Ngoài ngưỡng ({statusReason(metricKey, value, thresholds)})
        </p>
      )}
    </article>
  );
}

// Row 1 of the DASHBOARD page: the four soil-probe headline readings.
export function OverviewCards({ latest, thresholds }) {
  return (
    <section className="dash-row dash-row-primary">
      {SOIL_KEYS.map((key) => (
        <MetricCard
          key={key}
          metricKey={key}
          icon={ICON[key]}
          value={latest?.[key]}
          thresholds={thresholds}
        />
      ))}
    </section>
  );
}
