import { Router } from 'express';
import { asyncH, deviceAuth, deviceOrUserAuth } from '../middleware.js';
import { requireAuth, canControl } from '../auth.js';
import {
  getStatus,
  setMode,
  enqueueCommand,
  enqueueAllDevices,
  PANEL_STAGGER_SECONDS,
  reportFromMaster,
  setEmergencyStop,
  isEStopEngaged,
} from '../services.js';

export const statusRouter = Router();

// The panel sends a real JSON boolean, but a curl/ESP32 caller may send 1/0 or
// the strings — accept those, reject anything we'd have to guess at.
const asBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return null;
};

// System status: master/slave online, LoRa RSSI, operating mode.
// Readable by a logged-in browser OR by the ESP32 with its device key — the
// master polls this to find out the web engaged the emergency stop.
statusRouter.get(
  '/',
  deviceOrUserAuth,
  asyncH((req, res) => {
    res.json(getStatus());
  })
);

// Frontend switches AUTO/MANUAL. We both update our state AND enqueue a
// command so the ESP32 master learns about the change on its next poll.
statusRouter.post(
  '/mode',
  requireAuth,
  canControl,
  asyncH((req, res) => {
    const mode = String(req.body?.mode || '').toUpperCase();
    // 'NONE' = bỏ chọn, khoá toàn bộ đầu ra — trạng thái mà một tủ mới dựng lên
    // vẫn ở. Trước đây chỉ nhận AUTO/MANUAL, nên chọn một lần là KHÔNG BAO GIỜ
    // quay lại được trạng thái khoá: muốn bàn giao tủ ở thế an toàn, hoặc dọn
    // sau một buổi demo, đều không có đường.
    if (!['AUTO', 'MANUAL', 'NONE'].includes(mode))
      return res.status(400).json({ error: "mode must be 'AUTO', 'MANUAL' or 'NONE'" });

    // Going back to AUTO while the emergency stop is latched would show the
    // operator "TỰ ĐỘNG" on a system whose automation engine is inert. Refuse
    // instead of lying about it.
    if (mode === 'AUTO' && isEStopEngaged())
      return res.status(409).json({
        error: 'Đang DỪNG KHẨN CẤP — không thể bật chế độ TỰ ĐỘNG. Hãy gỡ dừng khẩn cấp trước.',
        eStop: true,
      });

    // Picking AUTO hands the panel to the field engine — it does NOT switch
    // everything on. The mixing and irrigation state machines live on the ESP32
    // and decide what runs, in what order, with the tank-empty and rain
    // interlocks the backend does not have. An earlier version energised all
    // nine actuators here; the engine simply overrode it seconds later, and
    // starting the nutrient pumps before anything had been mixed was wrong on
    // its own terms. Switching the whole panel on is now a separate, explicit
    // commissioning action — see POST /api/status/test-panel.
    // Bỏ chọn cũng phải TẮT HẾT, không chỉ khoá giao diện: 'NONE' nghĩa là
    // không ai đang cầm lái, mà bỏ mặc một cái bơm đang chạy trong trạng thái
    // đó thì tệ hơn hẳn so với để nguyên chế độ cũ.
    if (mode === 'NONE') enqueueAllDevices('OFF', { staggerSeconds: PANEL_STAGGER_SECONDS });

    enqueueCommand('mode', mode);
    // confirmed: false — mới chỉ là điều web YÊU CẦU. Chỉ khi ESP32 ack lệnh
    // vừa xếp hàng ở trên, hoặc tự báo về, thì mới tính là đã xác nhận.
    setMode(mode, { confirmed: false });
    res.json(getStatus());
  })
);

// POST /api/status/report -> the master telling us what it is actually doing.
//
// Mode can be changed in three places: this dashboard, the Nextion screen on the
// panel, and the mechanical switch inside the cabinet. Only the first went
// through us, so the web could sit showing THỦ CÔNG while the rig had been in
// TỰ ĐỘNG for an hour. The master now reports every change here.
//
// The same call carries the AUTO and mixing state-machine steps, which is the
// only way the dashboard can show what the field engine is doing — those
// machines run on the ESP32 and keep running with the network down.
//
// Body: { mode?, autoState?, mixState?, mixReady? } — all optional.
statusRouter.post(
  '/report',
  deviceAuth,
  asyncH((req, res) => {
    const b = req.body || {};
    res.json(
      reportFromMaster({
        mode: b.mode ? String(b.mode).toUpperCase() : undefined,
        autoState: b.autoState ?? b.auto_state,
        mixState: b.mixState ?? b.mix_state,
        mixReady: b.mixReady ?? b.mix_ready,
      })
    );
  })
);

// POST /api/status/test-panel -> commissioning sweep: switch every actuator on,
// valves first, two seconds apart.
//
// This is what the AUTO button used to do implicitly. As its own action it is
// honest about being a test, and it is available exactly when it is useful —
// checking the cabinet wiring relay by relay before handing over to AUTO.
//
// The stagger is not cosmetic: five pump motors closing together is an inrush
// the shared supply should never have to swallow, and a pump started against a
// shut valve is dead-heading into a closed line.
statusRouter.post(
  '/test-panel',
  requireAuth,
  canControl,
  asyncH((req, res) => {
    if (isEStopEngaged())
      return res.status(409).json({
        error: 'Đang DỪNG KHẨN CẤP — không thể chạy kiểm tra dàn.',
        eStop: true,
      });
    if (getStatus().mode !== 'MANUAL')
      return res.status(409).json({
        error: 'Chỉ chạy được ở chế độ THỦ CÔNG. Ở TỰ ĐỘNG, tủ điện từ chối mọi lệnh tay.',
      });

    const seconds =
      enqueueAllDevices('ON', { staggerSeconds: PANEL_STAGGER_SECONDS }) +
      PANEL_STAGGER_SECONDS;
    res.json({ ok: true, seconds, status: getStatus() });
  })
);

// Emergency stop latch — the red "DỪNG KHẨN CẤP" bar on the CONTROL screen.
// Body: { engaged: true | false }   (admin/technician)
// Engaging queues OFF for every actuator, forces MANUAL and raises a danger
// alert; while engaged nothing may be switched ON and AUTO stays inert.
statusRouter.post(
  '/estop',
  requireAuth,
  canControl,
  asyncH((req, res) => {
    const engaged = asBool(req.body?.engaged);
    if (engaged === null)
      return res.status(400).json({ error: 'engaged must be true or false' });

    res.json(setEmergencyStop(engaged, req.user?.username || 'người dùng'));
  })
);
