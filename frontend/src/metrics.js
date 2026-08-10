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
  // EC arrives from the probe in µS/cm and is STORED that way (telemetry rows
  // and thresholds alike). The panel labels it mS/cm, so every display path goes
  // through ecToMs()/fmtValue() — see `storedUnit` below.
  ec:          { label: 'Độ dẫn điện (EC)', en: 'EC Level', short: 'EC', unit: 'mS/cm', storedUnit: 'µS/cm', color: SERIES.orange, decimals: 2 },

  // --- Soil probe: registers 4..6, NPK (shown together in one plot) --------
  // For solids 1 mg/kg = 1 ppm, so ppm is used to match the panel labels.
  n: { label: 'Đạm (N)', en: 'Nitrogen', short: 'N', unit: 'ppm', color: SERIES.green, decimals: 0 },
  p: { label: 'Lân (P)', en: 'Phosphorus', short: 'P', unit: 'ppm', color: SERIES.orange, decimals: 0 },
  k: { label: 'Kali (K)', en: 'Potassium', short: 'K', unit: 'ppm', color: SERIES.purple, decimals: 0 },

  // --- Air probe + rain sensor ---------------------------------------------
  air_temp:     { label: 'Nhiệt độ không khí', en: 'Temperature (Air)', short: 'Nhiệt độ KK', unit: '°C', color: SERIES.blue, decimals: 1 },
  air_humidity: { label: 'Độ ẩm không khí', en: 'Humidity (Air)', short: 'Độ ẩm KK', unit: '%RH', color: SERIES.green, decimals: 1 },
  rain:         { label: 'Cảm biến mưa', en: 'Rain Sensor', short: 'Mưa', unit: '%', color: SERIES.purple, decimals: 0 },

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
export const AIR_KEYS = ['air_temp', 'air_humidity'];
export const LEVEL_KEYS = ['level1', 'level2', 'level3', 'level4'];
export const TANK_IDS = ['dist1', 'dist2', 'dist3', 'dist4'];

// The actuators wired to the slave node: five pumps and four valves.
export const DEVICE_IDS = {
  pumps: ['pump1', 'pump2', 'pump3', 'pump4', 'pump5'],
  valves: ['van1', 'van2', 'van3', 'van4'],
};

// Fallback display names, matching what the backend seeds into `devices`.
export const DEVICE_LABEL = {
  pump1: 'Bơm 1', pump2: 'Bơm 2', pump3: 'Bơm 3', pump4: 'Bơm 4', pump5: 'Bơm 5',
  van1: 'Van 1', van2: 'Van 2', van3: 'Van 3', van4: 'Van 4',
};

// Metrics an AUTO rule may be built on, grouped for the <optgroup> in Settings.
export const AUTOMATION_METRIC_GROUPS = [
  { label: 'Đất (RS485)', keys: [...SOIL_KEYS, ...NPK_KEYS] },
  { label: 'Không khí & mưa', keys: [...AIR_KEYS, 'rain'] },
  { label: 'Mực nước bồn (%)', keys: LEVEL_KEYS },
  { label: 'Khoảng cách siêu âm (cm)', keys: TANK_IDS },
];

// --- EC unit conversion -----------------------------------------------------
// Stored/transported in µS/cm, displayed in mS/cm. Never hand-roll the /1000.
export function ecToMs(rawMicro) {
  const n = Number(rawMicro);
  if (rawMicro == null || rawMicro === '' || Number.isNaN(n)) return null;
  return n / 1000;
}

// The inverse, for settings forms: user types mS/cm, storage wants µS/cm.
export function ecFromMs(ms) {
  const n = Number(ms);
  if (ms == null || ms === '' || Number.isNaN(n)) return null;
  return Math.round(n * 1000);
}

// Stored value -> the number actually drawn on screen (charts, gauges, axes).
// Only EC differs today; route every metric through here so it stays that way.
export function displayValue(value, key) {
  const n = Number(value);
  if (value == null || value === '' || Number.isNaN(n)) return null;
  return key === 'ec' ? n / 1000 : n;
}

// --- Threshold evaluation ---------------------------------------------------
// A configured bound, or null when the operator left that side open. Settings
// ships partial threshold objects, so "missing" must mean "no bound on that
// side" — never NaN comparisons that silently report everything as ok.
const bound = (v) => {
  const n = Number(v);
  return v == null || v === '' || Number.isNaN(n) ? null : n;
};

function rangeStatus(value, min, max, under = 'warn', over = 'warn') {
  const lo = bound(min);
  const hi = bound(max);
  if (hi != null && value > hi) return over;
  if (lo != null && value < lo) return under;
  return 'ok';
}

// Returns 'ok' | 'warn' | 'crit', or null when the metric has no threshold or
// the reading is missing. EC is compared in STORED units (µS/cm), the same
// units the thresholds are saved in.
export function metricStatus(key, value, thresholds) {
  if (value == null || !thresholds) return null;
  const t = thresholds;
  switch (key) {
    case 'temperature':
      // Heat is the dangerous side of this range, cold is only a warning.
      return rangeStatus(value, t.tempMin, t.tempMax, 'warn', 'crit');
    case 'humidity':
      return rangeStatus(value, t.humidityMin, t.humidityMax);
    case 'ph':
      return rangeStatus(value, t.phMin, t.phMax);
    case 'ec':
      return rangeStatus(value, t.ecMin, t.ecMax);
    case 'n':
      return rangeStatus(value, t.nMin, null);
    case 'p':
      return rangeStatus(value, t.pMin, null);
    case 'k':
      return rangeStatus(value, t.kMin, null);
    case 'level1':
    case 'level2':
    case 'level3':
    case 'level4': {
      const low = bound(t.tankLowPct);
      if (low == null) return 'ok';
      if (value < low / 2) return 'crit';
      return value < low ? 'warn' : 'ok';
    }
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
  const side = (min, max, unit) => {
    const hi = bound(max);
    return hi != null && value > hi ? `> ${hi}${unit}` : `< ${bound(min)}${unit}`;
  };
  switch (key) {
    case 'temperature': return side(t.tempMin, t.tempMax, '°C');
    case 'humidity': return side(t.humidityMin, t.humidityMax, '%');
    case 'ph': return side(t.phMin, t.phMax, '');
    case 'ec': {
      // Thresholds are stored in µS/cm but the HMI talks mS/cm.
      const hi = bound(t.ecMax);
      return hi != null && value > hi
        ? `> ${ecToMs(hi).toFixed(2)} mS/cm`
        : `< ${ecToMs(bound(t.ecMin)).toFixed(2)} mS/cm`;
    }
    case 'n': return `< ${bound(t.nMin)} ppm`;
    case 'p': return `< ${bound(t.pMin)} ppm`;
    case 'k': return `< ${bound(t.kMin)} ppm`;
    default: return `< ${bound(t.tankLowPct)}%`;
  }
}

// What the rain sensor is telling us, in words. `value` is the stored 0..100
// reading; null/absent means the node never reported one.
export function rainState(value) {
  const n = Number(value);
  if (value == null || value === '' || Number.isNaN(n)) {
    return { text: 'Không có dữ liệu', level: 'ok' };
  }
  if (n < 5) return { text: 'Không mưa', level: 'ok' };
  if (n < 40) return { text: 'Mưa nhẹ', level: 'warn' };
  return { text: 'Mưa to', level: 'crit' };
}

// --- Formatting -------------------------------------------------------------
// Takes the STORED value and returns the display string, so callers never have
// to know that EC is the one metric whose units change on the way to the screen.
export function fmtValue(value, key) {
  const n = Number(value);
  if (value == null || value === '' || Number.isNaN(n)) return '--';
  if (key === 'ec') return (n / 1000).toFixed(METRICS.ec.decimals);
  const m = METRICS[key];
  return n.toFixed(m?.decimals ?? 1);
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
