import {
  METRICS,
  SERIES,
  TANK_IDS,
  LEVEL_KEYS,
  fmtValue,
  metricStatus,
  rainState,
  STATUS_COLOR,
  STATUS_ICON,
} from '../metrics.js';
import { IconNutrient, IconRain, TANK_ICON } from './Icons.jsx';
// The air cards are the same readout as row 1, minus the glyph — reuse the card
// rather than keeping two copies of the value/alarm markup in step.
import { MetricCard } from './OverviewCards.jsx';

// Accent for the combined Kali & Đạm card. The panel design paints this one
// rose; it is a CARD ACCENT ONLY — never a chart series — and it is deliberately
// off the reserved crit red (#dc2626) so it cannot be misread as an alarm.
const ROSE = '#e11d48';

// The rain CARD is blue in the design (cloud glyph, left accent and wash all in
// the same blue). METRICS.rain.color stays purple because that is the rain
// SERIES hue in the 'Không khí & mưa' plot; the card just carries its own accent
// the way the nutrient card above does. Rain never shares a plot with anything
// else blue, so no chart ends up with two indistinguishable lines.
const RAIN_ACCENT = SERIES.blue;

// Boxed readouts pick up a tinted border when the value is out of range; the
// mark and the note beside them carry the actual meaning.
const boxState = (state) =>
  state === 'crit' ? ' is-crit' : state === 'warn' ? ' is-warn' : '';

function Mark({ state }) {
  return (
    <span className="dash-box-mark" style={{ color: STATUS_COLOR[state] }} aria-hidden="true">
      {STATUS_ICON[state]}
    </span>
  );
}

// Potassium and nitrogen share one card, as on the panel — those are the two the
// rig actually doses. Phosphorus is still recorded, charted and tabled below.
function NutrientCard({ latest, thresholds }) {
  const rows = [
    { key: 'k', minKey: 'kMin' },
    { key: 'n', minKey: 'nMin' },
  ].map(({ key, minKey }) => {
    const value = latest?.[key];
    const state = metricStatus(key, value, thresholds);
    return { key, m: METRICS[key], value, state, low: !!state && state !== 'ok', min: thresholds?.[minKey] };
  });

  const lows = rows.filter((r) => r.low);

  return (
    <article className="dash-card dash-card-nutrient" style={{ '--dash-accent': ROSE }}>
      <div className="dash-head">
        <span className="dash-head-icon">
          <IconNutrient size={68} />
        </span>
        <div className="dash-titles">
          <strong className="dash-title">Kali &amp; Đạm</strong>
          <em className="dash-en">Kali &amp; Nitrogen</em>
        </div>
      </div>

      <div className="dash-lines">
        {rows.map(({ key, m, value, state, low }) => (
          <div key={key} className="dash-line">
            <span className="dash-line-label">{m.label}</span>
            <span className={`dash-box${low ? boxState(state) : ''}`}>
              {low && <Mark state={state} />}
              {fmtValue(value, key)}
            </span>
            <span className="dash-line-unit">{m.unit}</span>
          </div>
        ))}
      </div>

      {lows.length > 0 && (
        <p className="dash-note" style={{ color: STATUS_COLOR[lows[0].state] }}>
          <span
            className="dash-mark"
            style={{ background: STATUS_COLOR[lows[0].state] }}
            aria-hidden="true"
          >
            {STATUS_ICON[lows[0].state]}
          </span>
          Thiếu dinh dưỡng:{' '}
          {lows.map((r) => `${r.m.short} < ${r.min} ${r.m.unit}`).join(' · ')}
        </p>
      )}
    </article>
  );
}

// The rain sensor reports a 0..100 wetness figure; operators read the words, so
// the state text is the headline and the raw percentage rides alongside it.
function RainCard({ latest }) {
  const raw = latest?.rain;
  const noData = raw == null || raw === '';
  const state = rainState(raw);
  const m = METRICS.rain;

  return (
    <article
      className="dash-card dash-card-flat dash-card-centred dash-card-rain"
      style={{ '--dash-accent': RAIN_ACCENT }}
    >
      <div className="dash-head">
        <div className="dash-titles">
          <strong className="dash-title">{m.label}</strong>
          <em className="dash-en">{m.en}</em>
        </div>
      </div>

      <span className="dash-rain-icon">
        <IconRain size={76} />
      </span>

      <div className={`dash-box dash-rain-box${noData ? '' : boxState(state.level)}`}>
        {!noData && state.level !== 'ok' && <Mark state={state.level} />}
        <span
          className="dash-rain-text"
          style={{ color: noData ? 'var(--muted)' : STATUS_COLOR[state.level] }}
        >
          {state.text}
        </span>
        {!noData && (
          <span className="dash-rain-pct">
            {fmtValue(raw, 'rain')} {m.unit}
          </span>
        )}
      </div>
    </article>
  );
}

// Four ultrasonic tanks. Three states have to stay apart here, because they send
// a maintainer to three different places:
//   * no telemetry row at all      -> the data link is down, say so once;
//   * a row arrived without a dist -> that one echo really is missing;
//   * a tank switched off in Settings -> not fitted, do not draw or alarm on it.
function TanksCard({ latest, tanks, thresholds }) {
  // `latest` is null until the first row lands (and stays null while the fetch
  // fails). That is a transport fault, not four dead sensors — see the note
  // rendered at the foot of the card.
  const noRow = !latest;

  // A tank the operator unfitted in Settings is muted end to end: the backend
  // drops its alert conditions outright (services.js, `if (!tank?.enabled)
  // return clearCondition(...)`), so the card must not keep drawing it or
  // raising its own under-threshold alarm. While the config is still in flight
  // `tanks` is undefined — that means "not known yet", not "all four off", so
  // every row stays visible until the real answer arrives.
  const shown = tanks ? TANK_IDS.filter((id) => !!tanks[id]?.enabled) : TANK_IDS;

  const rows = shown.map((id) => {
    // Index the level key by the tank's own position, never by the position it
    // happens to land on after filtering — otherwise disabling Bồn Đạm would
    // silently relabel Bồn Kali with Bồn Đạm's percentage.
    const levelKey = LEVEL_KEYS[TANK_IDS.indexOf(id)];
    const m = METRICS[levelKey];
    const pct = latest?.[levelKey];
    const offline = !noRow && latest[id] == null;
    const state = offline ? null : metricStatus(levelKey, pct, thresholds);
    return {
      id,
      levelKey,
      m,
      pct,
      offline,
      state,
      low: !!state && state !== 'ok',
      name: tanks?.[id]?.name || m.label,
      Icon: TANK_ICON[id],
    };
  });

  const lows = rows.filter((r) => r.low);
  const dead = rows.filter((r) => r.offline);
  const worst = lows.some((r) => r.state === 'crit') ? 'crit' : 'warn';

  return (
    <article
      className="dash-card dash-card-flat dash-card-centred dash-card-tanks"
      style={{ '--dash-accent': 'var(--blue)' }}
    >
      <div className="dash-head">
        <div className="dash-titles">
          <strong className="dash-title">Mực nước các bồn</strong>
        </div>
      </div>

      <ul className="dash-tanks">
        {rows.map(({ id, levelKey, m, pct, offline, state, low, name, Icon }) => {
          const known = !offline && pct != null;
          return (
            <li key={id} className="dash-tank">
              <span
                className="dash-tank-icon"
                style={{ color: known ? m.color : 'var(--muted)' }}
              >
                <Icon size={22} />
              </span>
              <span className="dash-tank-name">{name}</span>

              {/* The design's row is icon | name | box | % — four columns, no
                  separate bar. The fill lives INSIDE the box as a background
                  wash so the level still reads at a glance without costing a
                  fifth column the 1024px panel cannot spare. In range it is the
                  tank's own hue; out of range it takes the reserved status
                  colour, and the mark + the note below carry the meaning so the
                  state never rests on the wash alone. */}
              <span
                className={`dash-box dash-tank-value${low ? boxState(state) : ''}`}
                style={{
                  '--tank-fill': known ? `${Math.max(0, Math.min(100, pct))}%` : '0%',
                  '--tank-hue': (state && state !== 'ok' && STATUS_COLOR[state]) || m.color,
                }}
              >
                {low && <Mark state={state} />}
                <span className={known ? undefined : 'dash-tank-off'}>
                  {fmtValue(pct, levelKey)}
                </span>
              </span>
              <span className="dash-tank-unit">%</span>
            </li>
          );
        })}
      </ul>

      {rows.length === 0 && (
        <p className="dash-note dash-note-muted">Chưa có bồn nào được bật trong Cài đặt</p>
      )}

      {lows.length > 0 && (
        <p className="dash-note" style={{ color: STATUS_COLOR[worst] }}>
          <span className="dash-mark" style={{ background: STATUS_COLOR[worst] }} aria-hidden="true">
            {STATUS_ICON[worst]}
          </span>
          Dưới ngưỡng {thresholds?.tankLowPct}%: {lows.map((r) => r.name).join(', ')}
        </p>
      )}

      {/* "Nothing has arrived yet" and "this echo did not come back" are
          different faults: the first sends you to the link, the second to a
          sensor and its wiring. Never claim the second when it is the first. */}
      {noRow ? (
        rows.length > 0 && (
          <p className="dash-note dash-note-muted">Chưa có dữ liệu từ node</p>
        )
      ) : (
        dead.length > 0 && (
          <p className="dash-note dash-note-muted">
            Không có tiếng vọng siêu âm: {dead.map((r) => r.name).join(', ')}
          </p>
        )
      )}
    </article>
  );
}

// Row 2 of the DASHBOARD page: nutrients, the air probe, rain and tank levels.
export function SystemCards({ latest, tanks, thresholds }) {
  return (
    <section className="dash-row dash-row-secondary">
      <NutrientCard latest={latest} thresholds={thresholds} />
      <MetricCard metricKey="air_humidity" value={latest?.air_humidity} thresholds={thresholds} />
      <MetricCard metricKey="air_temp" value={latest?.air_temp} thresholds={thresholds} />
      <RainCard latest={latest} />
      <TanksCard latest={latest} tanks={tanks} thresholds={thresholds} />
    </section>
  );
}
