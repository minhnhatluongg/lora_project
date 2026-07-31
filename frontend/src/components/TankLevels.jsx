import {
  TANK_IDS,
  fmtValue,
  metricStatus,
  STATUS_COLOR,
  STATUS_ICON,
  STATUS_TEXT,
} from '../metrics.js';

// Four ultrasonic sensors, each measuring the air gap above the water in a tank.
// A gauge shows one magnitude, so identity comes from the tank name printed on
// it — colour is free to carry state (ok / low / critical) instead.
export function TankLevels({ latest, tanks, thresholds }) {
  const enabled = TANK_IDS.filter((id) => tanks?.[id]?.enabled !== false);

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Mực nước bồn chứa</h3>
        <span className="panel-sub">
          Cảm biến siêu âm · ngưỡng cạn {thresholds?.tankLowPct ?? '--'}%
        </span>
      </div>

      <div className="tank-grid">
        {enabled.map((id, i) => {
          const tank = tanks?.[id] || {};
          const levelKey = `level${i + 1}`;
          const pct = latest?.[levelKey];
          const distance = latest?.[id];
          const offline = distance == null;
          const state = offline ? 'crit' : metricStatus(levelKey, pct, thresholds);
          const color = offline ? '#64748b' : STATUS_COLOR[state] || STATUS_COLOR.ok;

          return (
            <figure key={id} className="tank">
              <div className="tank-body" role="img"
                aria-label={`${tank.name}: ${offline ? 'mất tín hiệu' : `${pct}%`}`}>
                <div
                  className="tank-fill"
                  style={{ height: `${offline ? 0 : pct}%`, background: color }}
                />
                <span className="tank-pct">
                  {offline ? '--' : `${pct}%`}
                </span>
              </div>

              <figcaption>
                <strong>{tank.name || `Bồn ${i + 1}`}</strong>
                {offline ? (
                  <span className="tank-state" style={{ color: STATUS_COLOR.crit }}>
                    {STATUS_ICON.crit} Mất tín hiệu
                  </span>
                ) : (
                  <>
                    <span className="tank-state" style={{ color }}>
                      {STATUS_ICON[state]} {STATUS_TEXT[state]}
                    </span>
                    <span className="tank-dist">
                      Khoảng cách {fmtValue(distance, id)} cm
                    </span>
                  </>
                )}
              </figcaption>
            </figure>
          );
        })}

        {enabled.length === 0 && (
          <p className="empty">Chưa bật bồn nào — bật trong Cài đặt &amp; Tự động.</p>
        )}
      </div>
    </div>
  );
}
