import { useState } from 'react';
import {
  METRICS,
  SOIL_KEYS,
  NPK_KEYS,
  TANK_IDS,
  LEVEL_KEYS,
  fmtValue,
  fmtDateTime,
} from '../metrics.js';

const VIEWS = [
  { id: 'soil', label: 'Đất + NPK', keys: [...SOIL_KEYS, ...NPK_KEYS] },
  { id: 'water', label: 'Bồn nước', keys: [...TANK_IDS, ...LEVEL_KEYS] },
];

// The table view of the same readings the charts plot — every value legible as
// text, which is also the accessible fallback for the colour-coded panels.
export function RecentTable({ rows }) {
  const [view, setView] = useState('soil');
  const keys = VIEWS.find((v) => v.id === view).keys;
  const list = rows || [];

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Dữ liệu mới nhất</h3>
        <div className="seg">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`seg-btn ${view === v.id ? 'seg-active' : ''}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              {keys.map((k) => (
                <th key={k} className="num">
                  {METRICS[k].short}
                  {METRICS[k].unit && <em> ({METRICS[k].unit})</em>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{fmtDateTime(r.created_at)}</td>
                {keys.map((k) => (
                  <td key={k} className="num">
                    {fmtValue(r[k], k)}
                  </td>
                ))}
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={keys.length + 1} className="empty">
                  Chưa có dữ liệu
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
