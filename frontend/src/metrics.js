// Single source of truth for what the STM32 node measures: labels, units,
// colours and threshold logic. Every panel reads from here so a metric looks
// and reads the same everywhere on the dashboard.
//
// Four series hues, taken from the panel design and then validated against the
// white chart surface: every pair is >= 9.7 ΔE apart under protanopia,
// deuteranopia and tritanopia, inside the light-mode lightness band, above the
// chroma floor and above 3:1 contrast. No group that shares a plot reuses a hue.
export const SERIES = {
  blue: '#2563eb',
  green: '#059669',
  purple: '#a21caf',
  orange: '#ea580c',
};

// Reserved status colours — darkened for a white background, and never used as
// a series colour. They always ship with an icon and a word, never colour alone.
export const STATUS_COLOR = {
  ok: '#15803d',
  warn: '#b45309',
  crit: '#dc2626',
};

export const STATUS_ICON = { ok: '✓', warn: '!', crit: '✕' };
export const STATUS_TEXT = { ok: 'Bình thường', warn: 'Cảnh báo', crit: 'Nguy hiểm' };

export const METRICS = {
  // --- Soil probe: registers 0..3 (shown as small multiples together) -------
  temperature: { label: 'Nhiệt độ', en: 'Temperature', short: 'Nhiệt độ', unit: '°C', color: SERIES.blue, decimals: 1 },
  humidity:    { label: 'Độ ẩm', en: 'Humidity', short: 'Độ ẩm', unit: '%RH', color: SERIES.green, decimals: 1 },
  ph:          { label: 'pH', en: 'pH Level', short: 'pH', unit: 'pH', color: SERIES.purple, decimals: 1 },
  ec:          { label: 'Độ dẫn điện (EC)', en: 'EC Level', short: 'EC', unit: 'µS/cm', color: SERIES.orange, decimals: 0 },

  // --- Soil probe: registers 4..6, NPK (shown together in one plot) --------
  // For solids 1 mg/kg = 1 ppm, so ppm is used to match the panel labels.
  n: { label: 'Đạm (N)', en: 'Nitrogen', short: 'N', unit: 'ppm', color: SERIES.green, decimals: 0 },
  p: { label: 'Lân (P)', en: 'Phosphorus', short: 'P', unit: 'ppm', color: SERIES.orange, decimals: 0 },
  k: { label: 'Kali (K)', en: 'Potassium', short: 'K', unit: 'ppm', color: SERIES.purple, decimals: 0 },

  // --- Ultrasonic tanks: raw distance + derived fill level ------------------
  // A fertigation rig: two nutrient tanks, a water tank and the mixing tank.
  dist1: { label: 'Khoảng cách bồn Kali', short: 'D1', unit: 'cm', color: SERIES.purple, decimals: 1 },
  dist2: { label: 'Khoảng cách bồn Đạm', short: 'D2', unit: 'cm', color: SERIES.green, decimals: 1 },
  dist3: { label: 'Khoảng cách bồn Nước', short: 'D3', unit: 'cm', color: SERIES.blue, decimals: 1 },
  dist4: { label: 'Khoảng cách bồn Trộn', short: 'D4', unit: 'cm', color: SERIES.orange, decimals: 1 },
  level1: { label: 'Bồn Kali', en: 'Potassium tank', short: 'Bồn Kali', unit: '%', color: SERIES.purple, decimals: 0 },
  level2: { label: 'Bồn Đạm', en: 'Nitrogen tank', short: 'Bồn Đạm', unit: '%', color: SERIES.green, decimals: 0 },
  level3: { label: 'Bồn Nước', en: 'Water tank', short: 'Bồn Nước', unit: '%', color: SERIES.blue, decimals: 0 },
  level4: { label: 'Trộn', en: 'Mixing tank', short: 'Trộn', unit: '%', color: SERIES.orange, decimals: 0 },
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
    case 'n': return `< ${t.nMin} ppm`;
    case 'p': return `< ${t.pMin} ppm`;
    case 'k': return `< ${t.kMin} ppm`;
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
