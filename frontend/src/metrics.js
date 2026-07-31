// Single source of truth for what the STM32 node measures: labels, units,
// colours and threshold logic. Every panel reads from here so a metric looks
// and reads the same everywhere on the dashboard.
//
// Colour sets were validated for the dark chart surface (#0f172a) — each group
// that appears together in one plot passes lightness-band, chroma, CVD
// separation (protan/deutan/tritan) and contrast checks.

// Reserved status colours. Never used as a series colour.
export const STATUS_COLOR = {
  ok: '#22c55e',
  warn: '#f59e0b',
  crit: '#ef4444',
};

export const STATUS_ICON = { ok: '✓', warn: '!', crit: '⨯' };
export const STATUS_TEXT = { ok: 'Bình thường', warn: 'Cảnh báo', crit: 'Nguy hiểm' };

export const METRICS = {
  // --- Soil probe: registers 0..3 (shown as small multiples together) -------
  temperature: { label: 'Nhiệt độ', short: 'Nhiệt độ', unit: '°C', icon: '🌡️', color: '#ea580c', decimals: 1 },
  humidity:    { label: 'Độ ẩm đất', short: 'Độ ẩm', unit: '%', icon: '💧', color: '#0891b2', decimals: 1 },
  ph:          { label: 'Độ pH', short: 'pH', unit: '', icon: '⚗️', color: '#8b5cf6', decimals: 1 },
  ec:          { label: 'Độ dẫn điện (EC)', short: 'EC', unit: 'µS/cm', icon: '🧪', color: '#db2777', decimals: 0 },

  // --- Soil probe: registers 4..6, NPK (shown together in one plot) --------
  n: { label: 'Đạm (N)', short: 'N', unit: 'mg/kg', icon: '🌿', color: '#2563eb', decimals: 0 },
  p: { label: 'Lân (P)', short: 'P', unit: 'mg/kg', icon: '🌾', color: '#d97706', decimals: 0 },
  k: { label: 'Kali (K)', short: 'K', unit: 'mg/kg', icon: '🍃', color: '#0d9488', decimals: 0 },

  // --- Ultrasonic tanks: raw distance + derived fill level ------------------
  dist1: { label: 'Khoảng cách 1', short: 'D1', unit: 'cm', color: '#0891b2', decimals: 1 },
  dist2: { label: 'Khoảng cách 2', short: 'D2', unit: 'cm', color: '#8b5cf6', decimals: 1 },
  dist3: { label: 'Khoảng cách 3', short: 'D3', unit: 'cm', color: '#d97706', decimals: 1 },
  dist4: { label: 'Khoảng cách 4', short: 'D4', unit: 'cm', color: '#db2777', decimals: 1 },
  level1: { label: 'Mực nước bồn 1', short: 'Bồn 1', unit: '%', color: '#0891b2', decimals: 0 },
  level2: { label: 'Mực nước bồn 2', short: 'Bồn 2', unit: '%', color: '#8b5cf6', decimals: 0 },
  level3: { label: 'Mực nước bồn 3', short: 'Bồn 3', unit: '%', color: '#d97706', decimals: 0 },
  level4: { label: 'Mực nước bồn 4', short: 'Bồn 4', unit: '%', color: '#db2777', decimals: 0 },
};

export const SOIL_KEYS = ['temperature', 'humidity', 'ph', 'ec'];
export const NPK_KEYS = ['n', 'p', 'k'];
export const LEVEL_KEYS = ['level1', 'level2', 'level3', 'level4'];
export const TANK_IDS = ['dist1', 'dist2', 'dist3', 'dist4'];

// Metrics an AUTO rule may be built on, grouped for the <optgroup> in Settings.
export const AUTOMATION_METRIC_GROUPS = [
  { label: 'Đất (RS485)', keys: [...SOIL_KEYS, ...NPK_KEYS] },
  { label: 'Mực nước bồn (%)', keys: LEVEL_KEYS },
  { label: 'Khoảng cách siêu âm (cm)', keys: TANK_IDS },
];

// --- Threshold evaluation ---------------------------------------------------
// Returns 'ok' | 'warn' | 'crit', or null when the metric has no threshold or
// the reading is missing.
export function metricStatus(key, value, thresholds) {
  if (value == null || !thresholds) return null;
  const t = thresholds;
  switch (key) {
    case 'temperature':
      return value > t.tempMax ? 'crit' : 'ok';
    case 'humidity':
      return value < t.humidityMin ? 'warn' : 'ok';
    case 'ph':
      return value < t.phMin || value > t.phMax ? 'warn' : 'ok';
    case 'ec':
      return value > t.ecMax ? 'warn' : 'ok';
    case 'n':
      return value < t.nMin ? 'warn' : 'ok';
    case 'p':
      return value < t.pMin ? 'warn' : 'ok';
    case 'k':
      return value < t.kMin ? 'warn' : 'ok';
    case 'level1':
    case 'level2':
    case 'level3':
    case 'level4':
      if (value < t.tankLowPct / 2) return 'crit';
      return value < t.tankLowPct ? 'warn' : 'ok';
    default:
      return null;
  }
}

// Human-readable reason a metric is out of range — shown next to the value so
// state is never communicated by colour alone.
export function statusReason(key, value, thresholds) {
  const s = metricStatus(key, value, thresholds);
  if (!s || s === 'ok') return null;
  const t = thresholds;
  switch (key) {
    case 'temperature': return `> ${t.tempMax}°C`;
    case 'humidity': return `< ${t.humidityMin}%`;
    case 'ph': return value < t.phMin ? `< ${t.phMin}` : `> ${t.phMax}`;
    case 'ec': return `> ${t.ecMax} µS/cm`;
    case 'n': return `< ${t.nMin} mg/kg`;
    case 'p': return `< ${t.pMin} mg/kg`;
    case 'k': return `< ${t.kMin} mg/kg`;
    default: return `< ${t.tankLowPct}%`;
  }
}

// --- Formatting -------------------------------------------------------------
export function fmtValue(value, key) {
  if (value == null || Number.isNaN(value)) return '--';
  const m = METRICS[key];
  return Number(value).toFixed(m?.decimals ?? 1);
}

// SQLite stores 'YYYY-MM-DD HH:MM:SS' in UTC.
const parse = (iso) => (iso ? new Date(iso.replace(' ', 'T') + 'Z') : null);

export const fmtTime = (iso) =>
  parse(iso)?.toLocaleTimeString('vi-VN', { hour12: false }) ?? '--:--:--';

export const fmtDateTime = (iso) =>
  parse(iso)?.toLocaleString('vi-VN', { hour12: false }) ?? '';

export const fmtShortTime = (iso) =>
  parse(iso)?.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) ?? '';

// Same two-point calibration the backend applies; used by Settings to preview a
// calibration before it is saved.
export function tankLevelPct(distanceCm, tank) {
  if (distanceCm == null || !tank) return null;
  const { emptyCm, fullCm } = tank;
  if (emptyCm == null || fullCm == null || emptyCm === fullCm) return null;
  return Math.round(
    Math.max(0, Math.min(100, ((emptyCm - distanceCm) / (emptyCm - fullCm)) * 100))
  );
}

// How long ago a reading arrived, in words.
export function timeAgo(iso) {
  const d = parse(iso);
  if (!d) return '--';
  const secs = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return `${secs} giây trước`;
  if (secs < 3600) return `${Math.round(secs / 60)} phút trước`;
  if (secs < 86400) return `${Math.round(secs / 3600)} giờ trước`;
  return `${Math.round(secs / 86400)} ngày trước`;
}

// What the STM32 reported about the last Modbus RS485 transaction.
export const SENSOR_STATUS_TEXT = {
  OK: { text: 'Đọc tốt', level: 'ok' },
  CRC: { text: 'Sai CRC — nhiễu đường truyền', level: 'warn' },
  HEADER: { text: 'Sai header Modbus', level: 'warn' },
  TIMEOUT: { text: 'Không phản hồi — kiểm tra dây', level: 'crit' },
  SHORT: { text: 'Nhận thiếu byte', level: 'warn' },
};
