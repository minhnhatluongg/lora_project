import {
  METRICS,
  TANK_IDS,
  LEVEL_KEYS,
  fmtValue,
  metricStatus,
  STATUS_COLOR,
} from '../metrics.js';
import { IconPump, IconValve, IconLora, IconTanks, TANK_ICON } from './Icons.jsx';

// State pill under each status card: active vs idle, always with a word and a
// mark so it never depends on colour alone.
function StatePill({ active, children }) {
  return (
    <span className={`pill-state ${active ? 'is-active' : 'is-idle'}`}>
      <span className="pill-mark" aria-hidden="true">{active ? '✓' : '✕'}</span>
      {children}
    </span>
  );
}

function StatusCard({ icon: Icon, title, en, accent, children }) {
  return (
    <article className="pcard pcard-status" style={{ '--accent': accent }}>
      <div className="pcard-titles pcard-titles-center">
        <strong>{title}</strong>
        <em>{en}</em>
      </div>
      <span className="pcard-bigicon">
        <Icon size={58} />
      </span>
      {children}
    </article>
  );
}

export function SystemCards({ devices, status, latest, tanks, thresholds }) {
  const list = devices || [];
  const pump = list.find((d) => d.id === 'pump');
  const valves = list.filter((d) => d.id.startsWith('van'));
  const openValves = valves.filter((v) => v.state === 'ON');

  const pumpOn = pump?.state === 'ON';
  const anyValveOpen = openValves.length > 0;
  const linkUp = !!status?.slaveOnline && !!status?.masterOnline;

  return (
    <section className="pcard-row pcard-row-status">
      <StatusCard
        icon={IconPump}
        title="Trạng thái bơm"
        en="Pump Status"
        accent={METRICS.humidity.color}
      >
        <StatePill active={pumpOn}>
          {pumpOn ? 'ĐANG HOẠT ĐỘNG' : 'KHÔNG HOẠT ĐỘNG'}
        </StatePill>
      </StatusCard>

      <StatusCard
        icon={IconValve}
        title="Trạng thái van"
        en="Valve Status"
        accent={METRICS.ec.color}
      >
        <StatePill active={anyValveOpen}>
          {anyValveOpen ? `ĐANG MỞ (${openValves.length}/${valves.length})` : 'ĐANG ĐÓNG'}
        </StatePill>
      </StatusCard>

      <StatusCard
        icon={IconLora}
        title="LoRa"
        en={status?.loraRssi != null ? `RSSI ${status.loraRssi} dBm` : 'Kết nối không dây'}
        accent={METRICS.temperature.color}
      >
        <StatePill active={linkUp}>{linkUp ? 'CONNECTED' : 'DISCONNECTED'}</StatePill>
      </StatusCard>

      <article className="pcard pcard-tanks" style={{ '--accent': METRICS.temperature.color }}>
        <div className="pcard-top">
          <span className="pcard-icon pcard-icon-sm">
            <IconTanks size={30} />
          </span>
          <span className="pcard-titles">
            <strong>Mực nước các bồn</strong>
            <em>Tank levels</em>
          </span>
        </div>

        <ul className="tank-rows">
          {TANK_IDS.map((id, i) => {
            const levelKey = LEVEL_KEYS[i];
            const m = METRICS[levelKey];
            const TankIcon = TANK_ICON[id];
            const name = tanks?.[id]?.name || m.label;
            const pct = latest?.[levelKey];
            const offline = latest?.[id] == null;
            const state = offline ? null : metricStatus(levelKey, pct, thresholds);
            const barColor = offline
              ? '#cbd5e1'
              : state === 'ok'
                ? m.color
                : STATUS_COLOR[state];

            return (
              <li key={id} className="tank-row">
                <span className="tank-row-icon" style={{ color: m.color }}>
                  <TankIcon size={18} />
                </span>
                <span className="tank-row-name">{name}</span>

                <span className="tank-row-track" title={offline ? 'Mất tín hiệu' : `${pct}%`}>
                  <span
                    className="tank-row-fill"
                    style={{ width: `${offline ? 0 : pct}%`, background: barColor }}
                  />
                </span>

                <span className={`tank-row-value${offline ? ' is-off' : ''}`}>
                  {offline ? '--' : fmtValue(pct, levelKey)}
                </span>
                <span className="tank-row-unit">%</span>
              </li>
            );
          })}
        </ul>
      </article>
    </section>
  );
}
