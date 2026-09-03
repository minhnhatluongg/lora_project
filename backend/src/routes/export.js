import { Router } from 'express';
import { db } from '../db.js';
import { asyncH } from '../middleware.js';
import { requireAuth } from '../auth.js';
import { getConfig, withLevelsAll } from '../services.js';
import { buildWorkbook, toExcelDate } from '../xlsx.js';

export const exportRouter = Router();

// Ba khoảng, cố ý TRÙNG với ba nút trên biểu đồ trang chủ. Người dùng đang nhìn
// một khoảng rồi bấm xuất thì thứ tải về phải đúng khoảng đó — không thì họ
// phải tự đối chiếu xem file chứa cái gì.
//
// Không có mốc "toàn bộ": TELEMETRY_RETENTION_DAYS = 7 nên "7 ngày" ĐÃ là toàn
// bộ. Bày thêm một nút hứa nhiều hơn số dữ liệu đang có là hứa suông.
const RANGES = {
  '1h': { hours: 1, label: '1 giờ gần nhất' },
  '24h': { hours: 24, label: '24 giờ gần nhất' },
  '7d': { hours: 24 * 7, label: '7 ngày gần nhất' },
};

// Trần số dòng của trang dữ liệu. 7 ngày ở nhịp 3 giây là ~201.600 dòng: Excel
// mở được, nhưng XML dựng ra tới vài chục MB và máy chủ phải giữ hết trong bộ
// nhớ trước khi nén. Quá trần thì gộp theo ô thời gian tròn phút, và NÓI RÕ ở
// trang Tổng quan là đã gộp — một file lặng lẽ bị làm thưa là một file dối.
const MAX_DETAIL_ROWS = 30000;
const BUCKETS = [10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

const num = (v, d = 1) =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(Number(v).toFixed(d));

const LEVEL_TEXT = { info: 'Thông tin', warning: 'Cảnh báo', danger: 'Nguy hiểm' };
const CMD_STATUS_TEXT = {
  pending: 'Đang chờ', sent: 'Đã gửi', acked: 'Đã xác nhận',
  failed: 'Thất bại', expired: 'Hết hạn', superseded: 'Bị thay thế',
};

// Chênh lệch hai mốc thời gian SQLite, tính bằng giây. Trả null nếu thiếu một
// đầu — 0 giây và "không biết" là hai chuyện khác nhau.
function gapSeconds(from, to) {
  if (!from || !to) return null;
  const a = Date.parse(from.replace(' ', 'T') + 'Z');
  const b = Date.parse(to.replace(' ', 'T') + 'Z');
  return Number.isFinite(a) && Number.isFinite(b) ? Number(((b - a) / 1000).toFixed(2)) : null;
}

// GET /api/telemetry/export?range=24h  ->  file .xlsx
exportRouter.get(
  '/export',
  requireAuth,
  asyncH((req, res) => {
    const key = String(req.query.range || '24h');
    const range = RANGES[key];
    if (!range)
      return res.status(400).json({ error: `range phải là một trong: ${Object.keys(RANGES).join(', ')}` });

    const since = `-${range.hours} hours`;
    const cfg = getConfig();

    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM telemetry WHERE created_at >= datetime('now', ?)`)
      .get(since).n;

    // Chọn ô gộp nhỏ nhất mà vẫn lọt trần. Bước nhảy là các mốc tròn (10s, 15s,
    // 30s, 1 phút…) chứ không phải một số lẻ tính ra từ phép chia: "trung bình
    // mỗi phút" đọc được, "trung bình mỗi 6,72 giây" thì không.
    let bucket = 0;
    if (total > MAX_DETAIL_ROWS) {
      const span = range.hours * 3600;
      bucket = BUCKETS.find((b) => span / b <= MAX_DETAIL_ROWS) || BUCKETS[BUCKETS.length - 1];
    }

    const rows = bucket
      ? db
          .prepare(
            `SELECT
               MIN(created_at) AS created_at,
               AVG(temperature) AS temperature, AVG(humidity) AS humidity,
               AVG(ph) AS ph, AVG(ec) AS ec,
               AVG(n) AS n, AVG(p) AS p, AVG(k) AS k,
               AVG(air_temp) AS air_temp, AVG(air_humidity) AS air_humidity,
               AVG(rain) AS rain,
               AVG(dist1) AS dist1, AVG(dist2) AS dist2,
               AVG(dist3) AS dist3, AVG(dist4) AS dist4,
               AVG(wifi_rssi) AS wifi_rssi,
               COUNT(*) AS samples
             FROM telemetry
             WHERE created_at >= datetime('now', ?)
             GROUP BY CAST(strftime('%s', created_at) AS INTEGER) / CAST(? AS INTEGER)
             ORDER BY created_at ASC`
          )
          .all(since, bucket)
      : db
          .prepare(
            `SELECT *, 1 AS samples FROM telemetry
             WHERE created_at >= datetime('now', ?) ORDER BY created_at ASC`
          )
          .all(since);

    const data = withLevelsAll(rows);

    // ---- Trang 1: Tổng quan --------------------------------------------
    const METRICS = [
      ['Nhiệt độ đất', 'temperature', '°C', cfg.thresholds?.tempMin, cfg.thresholds?.tempMax],
      ['Độ ẩm đất', 'humidity', '%', cfg.thresholds?.humidityMin, cfg.thresholds?.humidityMax],
      ['Độ pH', 'ph', 'pH', cfg.thresholds?.phMin, cfg.thresholds?.phMax],
      ['Độ dẫn điện EC', 'ec', 'µS/cm', cfg.thresholds?.ecMin, cfg.thresholds?.ecMax],
      ['Đạm (N)', 'n', 'mg/kg', cfg.thresholds?.nMin, null],
      ['Lân (P)', 'p', 'mg/kg', cfg.thresholds?.pMin, null],
      ['Kali (K)', 'k', 'mg/kg', cfg.thresholds?.kMin, null],
      ['Nhiệt độ không khí', 'air_temp', '°C', null, null],
      ['Độ ẩm không khí', 'air_humidity', '%', null, null],
      ['Mưa', 'rain', '%', null, null],
      ['Sóng WiFi', 'wifi_rssi', 'dBm', null, null],
    ];

    const stats = METRICS.map(([name, key, unit, lo, hi]) => {
      const vals = data.map((r) => r[key]).filter((v) => v !== null && Number.isFinite(Number(v)));
      if (!vals.length) return [name, unit, 0, null, null, null, lo ?? null, hi ?? null, null];
      const nums = vals.map(Number);
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      // Đếm số lần ra khỏi ngưỡng — con số này mới là thứ đáng nhìn đầu tiên
      // khi mở file, hơn hẳn một cột trung bình đẹp đẽ.
      const breaches =
        lo == null && hi == null
          ? null
          : nums.filter((v) => (lo != null && v < lo) || (hi != null && v > hi)).length;
      return [name, unit, nums.length, num(min, 2), num(max, 2), num(avg, 2), lo ?? null, hi ?? null, breaches];
    });

    const firstAt = data.length ? data[0].created_at : null;
    const lastAt = data.length ? data[data.length - 1].created_at : null;

    const info = [
      ['Khoảng thời gian', range.label],
      ['Thời điểm xuất', new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })],
      ['Người xuất', req.user?.username || '--'],
      ['Bản ghi đầu tiên', firstAt ? String(firstAt) + ' (UTC)' : 'không có dữ liệu'],
      ['Bản ghi cuối cùng', lastAt ? String(lastAt) + ' (UTC)' : 'không có dữ liệu'],
      ['Số bản ghi gốc', total],
      ['Số dòng trong file', data.length],
      [
        'Cách xử lý',
        bucket
          ? `Đã GỘP: mỗi dòng là trung bình của ${bucket} giây (vì ${total} bản ghi gốc vượt trần ${MAX_DETAIL_ROWS} dòng). Cột "Số mẫu" cho biết mỗi dòng gộp từ bao nhiêu bản ghi.`
          : 'Dữ liệu thô, không gộp — mỗi dòng là một bản ghi.',
      ],
      ['Múi giờ', 'Mọi cột thời gian trong file đã đổi sang giờ Việt Nam (UTC+7)'],
      ['Thời gian tưới', `${cfg.irrigation?.runMinutes ?? '--'} phút`],
      ['Thời gian nghỉ', `${cfg.irrigation?.restMinutes ?? '--'} phút`],
    ];

    const summary = {
      name: 'Tổng quan',
      title: 'BÁO CÁO HỆ THỐNG TƯỚI TIÊU CHÍNH XÁC',
      columns: [
        { header: 'Mục', width: 22, type: 'text' },
        { header: 'Giá trị', width: 30, type: 'text' },
        { header: 'Số mẫu', width: 10, type: 'number' },
        { header: 'Nhỏ nhất', width: 12, type: 'number' },
        { header: 'Lớn nhất', width: 12, type: 'number' },
        { header: 'Trung bình', width: 12, type: 'number' },
        { header: 'Ngưỡng dưới', width: 12, type: 'number' },
        { header: 'Ngưỡng trên', width: 12, type: 'number' },
        { header: 'Số lần vượt ngưỡng', width: 18, type: 'number' },
      ],
      rows: [
        ...info.map(([a, b]) => [a, String(b)]),
        [],
        ['THỐNG KÊ THEO CHỈ SỐ', '', '', '', '', '', '', '', ''],
        ...stats.map(([name, unit, n, mn, mx, avg, lo, hi, br]) => [name, unit, n, mn, mx, avg, lo, hi, br]),
      ],
    };

    // ---- Trang 2: Dữ liệu đo -------------------------------------------
    const detail = {
      name: 'Dữ liệu đo',
      columns: [
        { header: 'Thời gian (giờ VN)', width: 21, type: 'datetime' },
        { header: 'Nhiệt độ đất (°C)', width: 15, type: 'number' },
        { header: 'Độ ẩm đất (%)', width: 14, type: 'number' },
        { header: 'pH', width: 9, type: 'number' },
        { header: 'EC (µS/cm)', width: 12, type: 'number' },
        { header: 'N (mg/kg)', width: 11, type: 'number' },
        { header: 'P (mg/kg)', width: 11, type: 'number' },
        { header: 'K (mg/kg)', width: 11, type: 'number' },
        { header: 'Nhiệt độ KK (°C)', width: 15, type: 'number' },
        { header: 'Độ ẩm KK (%)', width: 13, type: 'number' },
        { header: 'Mưa (%)', width: 10, type: 'number' },
        { header: 'Bồn 1 (%)', width: 11, type: 'number' },
        { header: 'Bồn 2 (%)', width: 11, type: 'number' },
        { header: 'Bồn 3 (%)', width: 11, type: 'number' },
        { header: 'Bồn 4 (%)', width: 11, type: 'number' },
        { header: 'Bồn 1 (cm)', width: 11, type: 'number' },
        { header: 'Bồn 2 (cm)', width: 11, type: 'number' },
        { header: 'Bồn 3 (cm)', width: 11, type: 'number' },
        { header: 'Bồn 4 (cm)', width: 11, type: 'number' },
        { header: 'WiFi (dBm)', width: 12, type: 'number' },
        { header: 'Số mẫu', width: 9, type: 'number' },
      ],
      rows: data.map((r) => [
        toExcelDate(r.created_at),
        num(r.temperature), num(r.humidity), num(r.ph, 2), num(r.ec, 0),
        num(r.n, 0), num(r.p, 0), num(r.k, 0),
        num(r.air_temp), num(r.air_humidity), num(r.rain, 0),
        num(r.level1, 0), num(r.level2, 0), num(r.level3, 0), num(r.level4, 0),
        num(r.dist1), num(r.dist2), num(r.dist3), num(r.dist4),
        num(r.wifi_rssi, 0),
        r.samples ?? 1,
      ]),
    };

    // ---- Trang 3: Cảnh báo ---------------------------------------------
    const alerts = db
      .prepare(
        `SELECT * FROM alerts WHERE created_at >= datetime('now', ?) ORDER BY created_at DESC`
      )
      .all(since);

    const alertSheet = {
      name: 'Cảnh báo',
      columns: [
        { header: 'Thời gian (giờ VN)', width: 21, type: 'datetime' },
        { header: 'Mức', width: 13, type: 'text' },
        { header: 'Nội dung', width: 80, type: 'text' },
      ],
      rows: alerts.map((a) => [
        toExcelDate(a.created_at),
        LEVEL_TEXT[a.level] || a.level,
        a.message,
      ]),
    };

    // ---- Trang 4: Nhật ký lệnh -----------------------------------------
    const cmds = db
      .prepare(
        `SELECT * FROM commands WHERE created_at >= datetime('now', ?) ORDER BY created_at DESC LIMIT 5000`
      )
      .all(since);

    const cmdSheet = {
      name: 'Nhật ký lệnh',
      columns: [
        { header: 'Thời gian tạo (giờ VN)', width: 21, type: 'datetime' },
        { header: 'Thiết bị', width: 12, type: 'text' },
        { header: 'Lệnh', width: 26, type: 'text' },
        { header: 'Trạng thái', width: 14, type: 'text' },
        { header: 'Số lần gửi', width: 11, type: 'number' },
        { header: 'Giữ theo lịch (giây)', width: 18, type: 'number' },
        { header: 'Chờ ESP32 hỏi (giây)', width: 19, type: 'number' },
        { header: 'Phần cứng thực thi (giây)', width: 22, type: 'number' },
        { header: 'Trọn vòng (giây)', width: 16, type: 'number' },
      ],
      rows: cmds.map((c) => [
        toExcelDate(c.created_at),
        c.device_id,
        c.action,
        CMD_STATUS_TEXT[c.status] || c.status,
        c.attempts,
        gapSeconds(c.created_at, c.run_after),
        gapSeconds(c.run_after || c.created_at, c.sent_at),
        gapSeconds(c.sent_at, c.acked_at),
        gapSeconds(c.created_at, c.acked_at),
      ]),
    };

    const book = buildWorkbook([summary, detail, alertSheet, cmdSheet]);
    const stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace(/[-:T]/g, '')
      .replace(/(\d{8})(\d{4})/, '$1-$2');

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="smartfarm-${key}-${stamp}.xlsx"`);
    res.setHeader('Content-Length', book.length);
    return res.end(book);
  })
);
