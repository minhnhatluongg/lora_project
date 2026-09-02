import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceArea,
} from 'recharts';
import { api } from '../api.js';
import { socket, EVENTS } from '../socket.js';
// KHÔNG dùng fmtShortTime/fmtDateTime của metrics.js ở đây: hai hàm đó nhận
// định dạng của SQLite ("YYYY-MM-DD HH:MM:SS") và tự nối thêm 'Z'. Trục thời
// gian của recharts đưa xuống số mili-giây, đổi sang ISO thì chuỗi đã có sẵn
// 'Z' và bị nối thành '...ZZ' — ra Invalid Date trên mọi nhãn trục.
import { IconWifi, IconWarning } from './Icons.jsx';
import './Diagnostics.css';

// Chất lượng đường truyền WiFi giữa ESP32 và router.
//
// Ban đầu bảng này định vẽ sóng LoRa — đoạn đáng quan tâm hơn, giữa node cảm
// biến và ESP32. Nhưng module LoRa E32 nối qua UART KHÔNG có lệnh đọc RSSI, nên
// firmware chưa bao giờ gửi được giá trị nào và cột `lora_rssi` rỗng từ đầu.
// Muốn đo thật đoạn đó phải đổi sang module dòng E22.
//
// WiFi.RSSI() thì đo được ngay, không đổi phần cứng. Khác đoạn đường truyền,
// nhưng vẫn là số đo RF thật và vẫn trả lời đúng câu hỏi trung tâm: đường
// truyền có ĐỨNG VỮNG không, hay chập chờn.

const RANGES = [
  { hours: 1, label: '1 giờ' },
  { hours: 6, label: '6 giờ' },
  { hours: 24, label: '24 giờ' },
  { hours: 168, label: '7 ngày' },
];

// Ngưỡng của WiFi, KHÔNG dùng lại ngưỡng LoRa. Hai công nghệ khác hẳn nhau:
// LoRa thu được tới -120 dBm vẫn giải mã tốt nhờ trải phổ, còn WiFi xuống dưới
// -75 dBm là đã rớt gói và chậm thấy rõ. Giữ nguyên dải cũ ở đây thì một đường
// truyền WiFi đang chật vật vẫn nằm gọn trong vùng "Tốt".
const BANDS = [
  { from: -60, to: 0, label: 'Tốt', fill: '#16a34a' },
  { from: -75, to: -60, label: 'Trung bình', fill: '#d97706' },
  { from: -100, to: -75, label: 'Yếu', fill: '#dc2626' },
];

const GRID = '#e6ebf2';
const AXIS_INK = '#64748b';

const pad = (n) => String(n).padStart(2, '0');
// Nhận thẳng số mili-giây, không đi vòng qua chuỗi ISO.
const tickTime = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fullTime = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};

const fmtGap = (s) => {
  if (s == null) return '--';
  if (s < 90) return `${Math.round(s)} giây`;
  if (s < 5400) return `${Math.round(s / 60)} phút`;
  return `${(s / 3600).toFixed(1)} giờ`;
};

function Stat({ label, value, unit, tone, hint }) {
  return (
    <div className={`diag-stat${tone ? ' diag-tone-' + tone : ''}`} title={hint}>
      <span className="diag-stat-label">{label}</span>
      <span className="diag-stat-value">
        {value}
        {unit && value !== '--' && <em>{unit}</em>}
      </span>
    </div>
  );
}

export function LinkQualityPanel() {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.linkQuality(hours).then(
      (d) => { setData(d); setErr(''); },
      (e) => setErr(e.message || 'Không tải được dữ liệu đường truyền.')
    );
  }, [hours]);

  useEffect(() => { load(); }, [load]);

  // Có dòng đo mới thì vẽ lại. Không cần hỏi vòng: backend đã đẩy sự kiện này
  // mỗi lần ghi một gói telemetry.
  useEffect(() => {
    const onTelemetry = () => load();
    socket.on(EVENTS.TELEMETRY, onTelemetry);
    return () => socket.off(EVENTS.TELEMETRY, onTelemetry);
  }, [load]);

  // Chèn `null` vào những ô thời gian không có dòng đo nào, để recharts NGẮT
  // đường thay vì nối thẳng qua chỗ trống. Lúc mất liên lạc nhìn thấy ngay
  // bằng mắt — quan trọng hơn một đường liền mượt mà nói dối.
  const series = useMemo(() => {
    if (!data?.series?.length) return [];
    const step = data.bucketSeconds * 1000;
    const out = [];
    let prev = null;
    for (const p of data.series) {
      const t = new Date(p.t.replace(' ', 'T') + 'Z').getTime();
      if (prev != null && t - prev > step * 1.8) out.push({ t: prev + step, rssi: null });
      out.push({ t, rssi: p.rssi, worst: p.worst, n: p.n });
      prev = t;
    }
    return out;
  }, [data]);

  const empty = !series.length;

  return (
    <div className="panel diag-panel">
      <div className="panel-head">
        <h3>
          <IconWifi size={17} />
          Chất lượng sóng WiFi
        </h3>
        <div className="seg">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              type="button"
              className={`seg-btn ${hours === r.hours ? 'seg-active' : ''}`}
              onClick={() => setHours(r.hours)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <p className="diag-note">
        Cường độ sóng giữa ESP32 và router. Càng gần 0 càng mạnh;
        <strong> −60 dBm</strong> trở lên là tốt, dưới <strong>−75 dBm</strong> là yếu.
      </p>

      {err && (
        <p className="diag-msg is-bad" role="alert">
          <IconWarning size={15} />
          {err}
        </p>
      )}

      {empty ? (
        <p className="diag-empty">
          Chưa có số đo nào kèm cường độ sóng WiFi trong khoảng này. Cần nạp firmware
          ESP32 mới — bản cũ không gửi giá trị này.
        </p>
      ) : (
        <>
          <div className="diag-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 10, right: 8, bottom: 0, left: -6 }}>
                <defs>
                  <linearGradient id="rssiFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                {/* Dải chất lượng vẽ mờ phía sau: đọc được mức sóng mà không
                    phải nhẩm ngưỡng trong đầu. */}
                {BANDS.map((b) => (
                  <ReferenceArea
                    key={b.label}
                    y1={b.from}
                    y2={b.to}
                    fill={b.fill}
                    fillOpacity={0.055}
                    // "hidden" chứ KHÔNG phải "extendDomain": dải "Yếu" chạy
                    // tới −140 dBm, mà extendDomain kéo trục Y xuống tận đó để
                    // chứa nó — dữ liệu thật nằm gọn trong khoảng −64..−84 bị
                    // ép thành một vạch dẹt ở mép trên. Cắt dải theo trục, đừng
                    // để dải định đoạt trục.
                    ifOverflow="hidden"
                  />
                ))}
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  scale="time"
                  tickFormatter={tickTime}
                  tick={{ fontSize: 10, fill: AXIS_INK }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  minTickGap={38}
                />
                <YAxis
                  domain={['dataMin - 5', 'dataMax + 5']}
                  // Số nguyên, KHÔNG kèm đơn vị trên trục. Có `unit=" dBm"` thì
                  // nhãn dài quá bề rộng trục và bị bẻ làm hai dòng — nhãn trên
                  // cùng còn bị mép biểu đồ cắt mất một nửa. Đơn vị đã nói ở
                  // dòng chú thích ngay trên và ở từng ô thống kê bên dưới.
                  tickFormatter={(v) => Math.round(v)}
                  tick={{ fontSize: 10, fill: AXIS_INK }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  width={40}
                />
                <Tooltip content={<RssiTooltip />} />
                <Area
                  type="monotone"
                  dataKey="rssi"
                  stroke="#2563eb"
                  strokeWidth={1.8}
                  fill="url(#rssiFill)"
                  dot={false}
                  isAnimationActive={false}
                  // false: chỗ đứt là chỗ mất liên lạc, nối lại là xoá mất tin.
                  connectNulls={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="diag-stats">
            <Stat label="Hiện tại" value={series[series.length - 1]?.rssi ?? '--'} unit=" dBm" />
            <Stat label="Trung bình" value={data.avgRssi ?? '--'} unit=" dBm" />
            <Stat label="Mạnh nhất" value={data.bestRssi ?? '--'} unit=" dBm" tone="ok" />
            <Stat label="Yếu nhất" value={data.worstRssi ?? '--'} unit=" dBm" tone="warn" />
            <Stat
              label="Số gói đã nhận"
              value={data.samples?.toLocaleString('vi-VN') ?? '--'}
              hint={
                data.typicalIntervalSeconds
                  ? `Nhịp thường: mỗi ${data.typicalIntervalSeconds} giây một gói`
                  : undefined
              }
            />
            <Stat
              label="Lần mất liên lạc"
              value={data.gapCount ?? '--'}
              tone={data.gapCount > 0 ? 'bad' : 'ok'}
              hint={`Đếm những quãng im lặng dài hơn ${data.gapThresholdSeconds} giây`}
            />
            <Stat
              label="Lâu nhất"
              value={fmtGap(data.longestGapSeconds)}
              tone={data.longestGapSeconds ? 'bad' : undefined}
            />
          </div>

          {/* Nói thẳng giới hạn của phép đo, ngay dưới con số. Giao thức giữa
              hai node không đánh số thứ tự gói, nên KHÔNG có cách nào đếm đúng
              số gói đã mất — công bố một "tỉ lệ mất gói" ở đây sẽ là con số bịa. */}
          <p className="diag-caveat">
            Đây là sóng <strong>WiFi</strong> (ESP32 ↔ router), không phải sóng LoRa. Module LoRa
            E32 nối qua UART không cấp giá trị RSSI, nên đoạn ESP32 ↔ node cảm biến không đo được
            — muốn đo phải đổi sang module dòng E22. Cột <strong>Lần mất liên lạc</strong> đếm
            những quãng im lặng dài bất thường — dài hơn {data.gapThresholdSeconds} giây, tức gấp
            5 lần nhịp gửi thường đo được{data.typicalIntervalSeconds ? ` (${data.typicalIntervalSeconds} giây)` : ''}.
          </p>
        </>
      )}
    </div>
  );
}

function RssiTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (p.rssi == null) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-time">{fullTime(label)}</div>
      <div className="chart-tooltip-row">
        <span className="chart-swatch" style={{ background: '#2563eb' }} />
        <span className="chart-tooltip-name">Trung bình</span>
        <span className="chart-tooltip-value">{p.rssi} dBm</span>
      </div>
      {p.worst != null && p.worst !== p.rssi && (
        <div className="chart-tooltip-row">
          <span className="chart-swatch" style={{ background: '#94a3b8' }} />
          <span className="chart-tooltip-name">Yếu nhất</span>
          <span className="chart-tooltip-value">{p.worst} dBm</span>
        </div>
      )}
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-name">Số gói</span>
        <span className="chart-tooltip-value">{p.n}</span>
      </div>
    </div>
  );
}

export default LinkQualityPanel;
