import { useState } from 'react';
import {
  METRICS,
  SOIL_KEYS,
  NPK_KEYS,
  TANK_IDS,
  LEVEL_KEYS,
  fmtValue,
  fmtClock,
  fmtDay,
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

      {/* rt-table: cột đầu được ghim lại khi kéo ngang trên điện thoại — tám
          cột số liệu không tài nào nhét vừa màn hình, mà kéo tới cột K rồi thì
          không còn biết con số đó thuộc lúc nào nữa. */}
      <div className="table-wrap rt-table">
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
                {/* Hai <span> chứ không phải một chuỗi: rộng rãi thì CSS cho
                    chúng nằm cùng dòng như cũ, hẹp thì xếp giờ trên ngày dưới. */}
                <td className="rt-when">
                  <span className="rt-clock">{fmtClock(r.created_at)}</span>{' '}
                  <span className="rt-day">{fmtDay(r.created_at)}</span>
                </td>
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
