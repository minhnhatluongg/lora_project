import { fmtTime, fmtDateTime, STATUS_COLOR } from '../metrics.js';
import { IconInfo, IconWarning, IconStop } from './Icons.jsx';

// Emoji are out in this design, and the three levels must not be told apart by
// the row tint alone: each gets its own glyph shape and an <abbr>-style label
// that screen readers read out.
const LEVEL = {
  info: { Icon: IconInfo, color: 'var(--blue)', text: 'Thông tin' },
  warning: { Icon: IconWarning, color: STATUS_COLOR.warn, text: 'Cảnh báo' },
  danger: { Icon: IconStop, color: STATUS_COLOR.crit, text: 'Nguy hiểm' },
};

export function AlertsList({ alerts }) {
  return (
    <div className="panel">
      <h3>Cảnh báo gần nhất</h3>
      <ul className="alert-list">
        {(alerts || []).map((a) => {
          const level = LEVEL[a.level] || LEVEL.info;
          const { Icon } = level;
          return (
            <li key={a.id} className={`alert alert-${a.level}`}>
              <span
                className="alert-icon"
                style={{ color: level.color }}
                role="img"
                aria-label={level.text}
              >
                <Icon size={18} />
              </span>
              <span className="alert-time" title={fmtDateTime(a.created_at)}>
                {fmtTime(a.created_at)}
              </span>
              <span className="alert-msg">{a.message}</span>
            </li>
          );
        })}
        {(!alerts || alerts.length === 0) && (
          <li className="empty">Không có cảnh báo</li>
        )}
      </ul>
    </div>
  );
}
