import { Router } from 'express';
import { asyncH, deviceAuth } from '../middleware.js';
import { requireAuth, canConfig } from '../auth.js';
import { getConfig, setConfig, enqueueCommand } from '../services.js';

export const configRouter = Router();

// GET /api/config -> thresholds + automation rules (any logged-in user can read)
configRouter.get(
  '/',
  requireAuth,
  asyncH((req, res) => {
    res.json(getConfig());
  })
);

// A watering time of "-5 phút" would make the short-cycle guard nonsense, and a
// blank field arrives as ''. Clamp to a non-negative number, keep what we had
// when the value is unusable.
const minutes = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// PUT /api/config -> update (admin/technician only).
// Body may contain { thresholds, irrigation, tanks, automation }. Sections merge
// shallowly; tanks/automation merge one level deeper so a partial rule keeps its
// other keys.
configRouter.put(
  '/',
  requireAuth,
  canConfig,
  asyncH((req, res) => {
    const current = getConfig();
    const body = req.body || {};

    const mergeEntries = (base, patch) => {
      const out = { ...base };
      for (const [id, value] of Object.entries(patch || {})) {
        out[id] = { ...(base[id] || {}), ...value };
      }
      return out;
    };

    const irrigation = { ...current.irrigation, ...(body.irrigation || {}) };
    irrigation.runMinutes = minutes(irrigation.runMinutes, current.irrigation?.runMinutes ?? 15);
    irrigation.restMinutes = minutes(irrigation.restMinutes, current.irrigation?.restMinutes ?? 45);

    const next = {
      thresholds: { ...current.thresholds, ...(body.thresholds || {}) },
      irrigation,
      tanks: mergeEntries(current.tanks, body.tanks),
      automation: mergeEntries(current.automation, body.automation),
    };
    const saved = setConfig(next);

    // Lưu vào CSDL KHÔNG có nghĩa là tủ điện biết. Máy chủ không gọi xuống ESP32
    // được (nó nằm sau NAT), nên mọi thứ muốn tới nơi đều phải xếp hàng đợi nó
    // hỏi. Thiếu đúng dòng này, trang CÀI ĐẶT chỉ sửa được bản sao trên máy chủ:
    // web hiện ngưỡng mới, còn tủ vẫn tưới theo ngưỡng cũ — và không có chỗ nào
    // báo cho người dùng biết hai bên đang bất đồng.
    if (changedForField(current, saved)) enqueueCommand('settings', fieldPayload(saved));

    res.json(saved);
  })
);

// ---- Gửi ngưỡng xuống tủ điện ---------------------------------------------
// Firmware chỉ dùng đúng mười giá trị này; bồn chứa và luật tự động là chuyện
// riêng của máy chủ nên không gửi xuống.
const FIELD_VALUES = (c) => [
  c.thresholds?.phMin, c.thresholds?.phMax,
  c.thresholds?.ecMin, c.thresholds?.ecMax,
  c.thresholds?.tempMin, c.thresholds?.tempMax,
  c.thresholds?.humidityMin, c.thresholds?.humidityMax,
  c.irrigation?.runMinutes, c.irrigation?.restMinutes,
];

// Chỉnh hiệu chuẩn bồn nước thì không việc gì phải đánh thức tủ điện. Chỉ xếp
// lệnh khi một trong mười giá trị tủ thật sự dùng có đổi — mỗi lệnh gửi xuống
// còn kéo theo một lượt phát <SET_DATA=...> qua LoRa tới node cảm biến.
const changedForField = (before, after) =>
  FIELD_VALUES(before).some((v, i) => v !== FIELD_VALUES(after)[i]);

// Dạng "SAVE=..." mười trường, đúng thứ tự getValue() trong firmware. Dùng dạng
// này chứ không dùng JSON vì bộ đệm đọc phản hồi của ESP32 chỉ 1024 byte, mà
// JSON mười khoá đã chiếm quá nửa.
//
// EC phải CHIA 1000: web lưu µS/cm, còn ecMin/ecMax trong sketch là mS/cm (xem
// POST /thresholds bên dưới, chiều ngược lại nhân 1000). Gửi thẳng số µS/cm
// xuống là đặt ngưỡng sai đi một nghìn lần.
function fieldPayload(c) {
  const n = (v, d = 1) => (Number.isFinite(Number(v)) ? Number(v) : 0).toFixed(d);
  const t = c.thresholds || {};
  const irr = c.irrigation || {};
  return (
    'SAVE=' +
    [
      n(t.phMin), n(t.phMax),
      n(t.ecMin / 1000, 2), n(t.ecMax / 1000, 2),
      n(t.tempMin), n(t.tempMax),
      n(t.humidityMin), n(t.humidityMax),
      Math.round(Number(irr.runMinutes) || 0),
      Math.round(Number(irr.restMinutes) || 0),
    ].join(',')
  );
}

// POST /api/config/thresholds -> the ESP32 reporting the ten values an operator
// just entered on the Nextion, so the web SETTINGS screen shows what the panel
// is actually running on rather than a stale copy.
//
// Device-authenticated (x-api-key): the master has no user account. It sends a
// FLAT body with the firmware's own names, which differ from ours in three
// places, hence the explicit mapping rather than a spread:
//
//     humMin/humMax  -> thresholds.humidityMin/humidityMax
//     timeBom        -> irrigation.runMinutes
//     timeNghi       -> irrigation.restMinutes
//
// EC không phải đổi Ở CHIỀU NÀY: sketch giữ ecMin/ecMax theo mS/cm nhưng đã
// nhân 1000 trước khi gửi, nên số tới đây đã là µS/cm — đúng đơn vị ta lưu.
// Chiều ngược lại thì phải chia 1000, xem fieldPayload() ở trên.
//
// Every field is optional. A key that is absent or unusable leaves the stored
// value alone, so a partial or half-garbled packet can never blank the config.
const THRESHOLD_FIELDS = {
  phMin: 'phMin',
  phMax: 'phMax',
  ecMin: 'ecMin',
  ecMax: 'ecMax',
  tempMin: 'tempMin',
  tempMax: 'tempMax',
  humMin: 'humidityMin',
  humMax: 'humidityMax',
};

configRouter.post(
  '/thresholds',
  deviceAuth,
  asyncH((req, res) => {
    const body = req.body || {};
    const current = getConfig();

    const thresholds = { ...current.thresholds };
    for (const [from, to] of Object.entries(THRESHOLD_FIELDS)) {
      const n = Number(body[from]);
      if (Number.isFinite(n)) thresholds[to] = n;
    }

    const irrigation = { ...current.irrigation };
    irrigation.runMinutes = minutes(body.timeBom, irrigation.runMinutes);
    irrigation.restMinutes = minutes(body.timeNghi, irrigation.restMinutes);

    res.json(setConfig({ ...current, thresholds, irrigation }));
  })
);
