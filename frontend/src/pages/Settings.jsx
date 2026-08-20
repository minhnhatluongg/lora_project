import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '../components/PageShell.jsx';
import { api } from '../api.js';
import { socket, EVENTS } from '../socket.js';
import {
  IconGear,
  IconClock,
  IconHumidity,
  IconHumidityPct,
  IconTemperature,
  IconTanks,
  IconAuto,
  IconRestart,
  IconSync,
  IconSave,
  IconWarning,
  IconInfo,
} from '../components/Icons.jsx';
import {
  METRICS,
  TANK_IDS,
  AUTOMATION_METRIC_GROUPS,
  DEVICE_LABEL,
  tankLevelPct,
  ecToMs,
  ecFromMs,
  fmtValue,
} from '../metrics.js';
import './Settings.css';

// The four MIN/MAX boxes of the panel's "CÀI ĐẶT NGƯỠNG" card, in panel order.
// `ec` marks the one pair the operator types in mS/cm while storage stays µS/cm.
// Titles are written in the exact case the panel uses — "NGƯỠNG pH" keeps its
// lowercase p, so this text is never run through text-transform. `name` is the
// readable form used for the inputs' accessible names.
const THRESHOLD_BOXES = [
  { title: 'NGƯỠNG pH', name: 'pH', glyph: 'drop', tone: 'blue', min: 'phMin', max: 'phMax' },
  { title: 'NGƯỠNG EC (mS/cm)', name: 'EC', glyph: 'ec', tone: 'blue', min: 'ecMin', max: 'ecMax', ec: true },
  { title: 'NGƯỠNG NHIỆT ĐỘ (°C)', name: 'nhiệt độ', glyph: 'temp', tone: 'red', min: 'tempMin', max: 'tempMax' },
  // Its own droplet-with-% glyph: pH and humidity must not be one drawing told
  // apart by hue alone.
  { title: 'NGƯỠNG ĐỘ ẨM (%)', name: 'độ ẩm', glyph: 'humidity', tone: 'green', min: 'humidityMin', max: 'humidityMax' },
];

const MINUTE_FIELDS = ['runMinutes', 'restMinutes'];

// Single-sided bounds metricStatus() reads but the design's four boxes do not
// cover: the NPK floors and the tank-low warning level. Blank means "no bound",
// which is exactly how metricStatus() treats a missing threshold.
const EXTRA_BOUNDS = [
  { key: 'nMin', label: 'Đạm (N) tối thiểu', unit: 'ppm', step: '1' },
  { key: 'pMin', label: 'Lân (P) tối thiểu', unit: 'ppm', step: '1' },
  { key: 'kMin', label: 'Kali (K) tối thiểu', unit: 'ppm', step: '1' },
  { key: 'tankLowPct', label: 'Cảnh báo bồn cạn dưới', unit: '%', step: '1', max: 100 },
];

// Only used when the server has never been told a watering cycle, so the two
// inputs are never blank and the operator can always save a valid pair.
const IRRIGATION_FALLBACK = { runMinutes: 15, restMinutes: 45 };

// `value` is held as TEXT in display units, like every other number on this
// page — see toText/parseNum below.
const DEFAULT_RULE = { enabled: false, metric: 'humidity', op: 'below', value: '40' };

// Every editable number on this page — thresholds, minutes, tank calibration and
// AUTO rule levels — is held as a string so a cleared or half-typed box ("10.",
// "1e", "") survives the keystroke instead of collapsing to 0. Parsing happens
// once, in validate/save.
const toText = (v) =>
  v == null || v === '' || Number.isNaN(Number(v)) ? '' : String(v);

const parseNum = (raw) => {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (s === '') return { empty: true, value: null };
  const n = Number(s);
  return { empty: false, value: Number.isFinite(n) ? n : NaN };
};

// Committed value of a draft box: a real number, or null for "left blank".
const commit = (raw) => {
  const r = parseNum(raw);
  return r.empty || !Number.isFinite(r.value) ? null : r.value;
};

// Draft tank rows: name/enabled as-is, both distances as text.
const toTankDraft = (tanks) =>
  Object.fromEntries(
    Object.entries(tanks || {}).map(([id, t]) => [
      id,
      { name: t?.name ?? '', enabled: t?.enabled !== false, emptyCm: toText(t?.emptyCm), fullCm: toText(t?.fullCm) },
    ])
  );

// Draft AUTO rows. EC rules are STORED in µS/cm and TYPED in mS/cm, so the draft
// carries the display number and save() converts back through metrics.js.
const toRuleDraft = (automation) =>
  Object.fromEntries(
    Object.entries(automation || {}).map(([dev, r]) => {
      const rule = { ...DEFAULT_RULE, ...(r || {}) };
      return [
        dev,
        {
          enabled: Boolean(rule.enabled),
          metric: rule.metric,
          op: rule.op === 'above' ? 'above' : 'below',
          value: toText(rule.metric === 'ec' ? ecToMs(rule.value) : rule.value),
        },
      ];
    })
  );

// The stored (µS/cm for EC) number a draft rule commits to.
const ruleStored = (rule) => (rule.metric === 'ec' ? ecFromMs(rule.value) : commit(rule.value));

// Every MIN must sit below its MAX, the cycle minutes must be a sane
// non-negative number, every tank must have "khi cạn" strictly greater than
// "khi đầy", and an enabled AUTO rule must have a real threshold. One pure
// function decides what red means, for all four tables — save() refuses on any
// key it returns, and the tank/rule rows render straight off it.
export function validateSettingsForm(form, tanks, automation) {
  const errs = {};

  for (const box of THRESHOLD_BOXES) {
    const lo = parseNum(form[box.min]);
    const hi = parseNum(form[box.max]);
    if (!lo.empty && !Number.isFinite(lo.value)) errs[box.min] = 'Giá trị MIN không hợp lệ';
    if (!hi.empty && !Number.isFinite(hi.value)) errs[box.max] = 'Giá trị MAX không hợp lệ';
    if (!errs[box.min] && !errs[box.max] && !lo.empty && !hi.empty && lo.value >= hi.value) {
      errs[box.min] = 'MIN phải nhỏ hơn MAX';
      errs[box.max] = 'MIN phải nhỏ hơn MAX';
    }
  }

  for (const key of MINUTE_FIELDS) {
    const v = parseNum(form[key]);
    if (v.empty || !Number.isFinite(v.value)) errs[key] = 'Nhập số phút';
    else if (v.value < 0) errs[key] = 'Số phút không được âm';
    else if (v.value > 1440) errs[key] = 'Tối đa 1440 phút (24 giờ)';
  }

  // Single-sided bounds: blank is legal ("no bound"), a typed value is not free
  // to be negative or, for a percentage, above 100.
  for (const b of EXTRA_BOUNDS) {
    const v = parseNum(form[b.key]);
    if (v.empty) continue;
    if (!Number.isFinite(v.value)) errs[b.key] = 'Giá trị không hợp lệ';
    else if (v.value < 0) errs[b.key] = 'Không được âm';
    else if (b.max != null && v.value > b.max) errs[b.key] = `Tối đa ${b.max}`;
  }

  // Tank calibration. The backend derives level1..4 from these two numbers for
  // EVERY tank, enabled or not, and returns null when they are equal — which is
  // how an accepted "empty === full" used to blank the whole dashboard.
  for (const id of TANK_IDS) {
    const t = (tanks && tanks[id]) || {};
    const key = `tank.${id}`;
    const lo = parseNum(t.emptyCm);
    const hi = parseNum(t.fullCm);
    if (lo.empty && hi.empty) {
      // A switched-off tank may legitimately have no calibration at all.
      if (t.enabled !== false) errs[key] = 'Nhập khoảng cách khi cạn và khi đầy';
      continue;
    }
    if (lo.empty || !Number.isFinite(lo.value)) errs[key] = 'Nhập "khi cạn" là một số (cm)';
    else if (hi.empty || !Number.isFinite(hi.value)) errs[key] = 'Nhập "khi đầy" là một số (cm)';
    else if (lo.value < 0 || hi.value < 0) errs[key] = 'Khoảng cách không được âm';
    else if (lo.value <= hi.value) errs[key] = '"Khi cạn" phải lớn hơn "khi đầy"';
  }

  // AUTO rules. A blank threshold on an ENABLED rule used to be written as 0,
  // i.e. a rule that can never fire again.
  for (const [dev, r] of Object.entries(automation || {})) {
    const rule = { ...DEFAULT_RULE, ...(r || {}) };
    if (!rule.enabled) continue;
    const v = ruleStored(rule);
    if (v == null || !Number.isFinite(v)) errs[`rule.${dev}`] = 'Nhập ngưỡng cho luật đang bật';
  }

  return errs;
}

// api.js gains restartSystem/restoreDefaults from the integration agent; until
// then a press must report a clear reason instead of throwing "not a function".
const callApi = (name, ...args) => {
  const fn = api[name];
  if (typeof fn !== 'function') {
    return Promise.reject(new Error('Máy chủ chưa hỗ trợ chức năng này'));
  }
  return fn(...args);
};

const CONFIRM_TEXT = {
  restart: 'Khởi động lại sẽ ngắt kết nối máy chủ và dừng mọi thiết bị đang chạy. Tiếp tục?',
  restore: 'Khôi phục cài đặt gốc sẽ xoá toàn bộ ngưỡng, hiệu chuẩn bồn và luật AUTO hiện tại. Tiếp tục?',
  leave: 'Trang này còn thay đổi chưa lưu. Rời khỏi SETTINGS bây giờ sẽ bỏ toàn bộ chỉnh sửa. Tiếp tục?',
};
const CONFIRM_TITLE = {
  restart: 'Khởi động lại hệ thống?',
  restore: 'Khôi phục cài đặt gốc?',
  leave: 'Bỏ thay đổi chưa lưu?',
};

// One JSON string per draft, so "has anything changed since the last applied
// config" is a string compare rather than a deep walk. Both sides are built by
// the same normalisers, so key order is stable.
const snapshot = (form, tanks, rules) => JSON.stringify([form, tanks, rules]);

export function Settings() {
  const navigate = useNavigate();
  const [cfg, setCfg] = useState(null);     // tanks + automation drafts live here
  const [form, setForm] = useState(null);   // string-valued threshold / timing inputs
  const [errors, setErrors] = useState({});
  const [latest, setLatest] = useState(null);
  const [devices, setDevices] = useState([]);
  const [msg, setMsg] = useState(null);     // { kind, text } for save + validation
  const [sysMsg, setSysMsg] = useState(null);
  const [confirming, setConfirming] = useState(null); // 'restart' | 'restore' | 'leave' | null
  const [pendingNav, setPendingNav] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sysBusy, setSysBusy] = useState(null);
  // Seeded from the real transport, never a flat `true`: the link lamp must not
  // claim a server that was never reached (the shell draws an honest grey
  // "unknown" only when a page passes nothing at all — this page passes a value,
  // so the value itself has to be true).
  const [online, setOnline] = useState(socket.connected);
  const [baseline, setBaseline] = useState(null);

  const msgRef = useRef(null);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const [scrollTick, setScrollTick] = useState(0);

  // Load the config into both halves of the page state at once, so the form and
  // the deeper panels can never drift apart, and record the snapshot the dirty
  // check compares against.
  const applyConfig = useCallback((next) => {
    const t = next?.thresholds || {};
    const irr = { ...IRRIGATION_FALLBACK, ...(next?.irrigation || {}) };
    const tanks = toTankDraft(next?.tanks);
    const automation = toRuleDraft(next?.automation);
    const nextForm = {
      phMin: toText(t.phMin),
      phMax: toText(t.phMax),
      // Stored in µS/cm, typed in mS/cm — metrics.js owns the factor.
      ecMin: toText(ecToMs(t.ecMin)),
      ecMax: toText(ecToMs(t.ecMax)),
      tempMin: toText(t.tempMin),
      tempMax: toText(t.tempMax),
      humidityMin: toText(t.humidityMin),
      humidityMax: toText(t.humidityMax),
      runMinutes: toText(irr.runMinutes),
      restMinutes: toText(irr.restMinutes),
      nMin: toText(t.nMin),
      pMin: toText(t.pMin),
      kMin: toText(t.kMin),
      tankLowPct: toText(t.tankLowPct),
    };
    setCfg({ ...next, thresholds: t, irrigation: irr, tanks, automation });
    setForm(nextForm);
    setErrors({});
    setBaseline(snapshot(nextForm, tanks, automation));
  }, []);

  // NB: REST outcomes deliberately do NOT touch `online`. The lamp means "the
  // realtime link to the server is up", and REST succeeding proves nothing about
  // the socket — on this page especially, where the "Đọc hiện tại" column is fed
  // by telemetry events. A green lamp driven by a successful GET would tell the
  // operator the live column is trustworthy while it sits frozen. Failures still
  // report themselves through setMsg.
  useEffect(() => {
    api
      .getConfig()
      .then((c) => {
        applyConfig(c);
      })
      .catch((e) => {
        setMsg({ kind: 'err', text: 'Không tải được cấu hình: ' + e.message });
      });
    // Used to preview each tank's calibration against a real reading.
    api.latest().then(setLatest).catch(() => {});
    // AUTO rules are listed from the live device roster (5 pumps + 4 valves).
    api.devices().then((d) => setDevices(Array.isArray(d) ? d : [])).catch(() => {});
  }, [applyConfig]);

  // "Đọc hiện tại" has to BE the current reading: calibrating a tank against a
  // distance frozen at page-load is exactly the mistake the preview exists to
  // prevent. One row on one event — this page still stays off useFarm and its
  // 24h history.
  useEffect(() => {
    const onTelemetry = (row) => setLatest(row);
    const onConnect = () => setOnline(true);
    const onDisconnect = () => setOnline(false);
    socket.on(EVENTS.TELEMETRY, onTelemetry);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    // Same re-read as every other page: a 'connect' that landed between render
    // and this effect would otherwise latch the lamp on a stale reading.
    setOnline(socket.connected);
    return () => {
      socket.off(EVENTS.TELEMETRY, onTelemetry);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  useEffect(() => {
    if (scrollTick) msgRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [scrollTick]);

  const deviceName = useCallback(
    (id) => devices.find((d) => d.id === id)?.name || DEVICE_LABEL[id] || id,
    [devices]
  );

  // Device order comes from the roster; any rule for a device the API did not
  // list is still shown so a saved rule can never become invisible.
  const ruleIds = useMemo(() => {
    const fromDevices = devices.map((d) => d.id);
    const extra = Object.keys(cfg?.automation || {}).filter((id) => !fromDevices.includes(id));
    return [...fromDevices, ...extra];
  }, [devices, cfg]);

  // Live verdict on the whole draft. The tank and AUTO rows render off this, so
  // the row warning and the refusal to save can never disagree the way they did
  // when the row drew its own `invalid` flag.
  const liveErrs = useMemo(
    () => (form ? validateSettingsForm(form, cfg?.tanks, cfg?.automation) : {}),
    [form, cfg]
  );

  const dirty = Boolean(
    baseline && form && cfg && snapshot(form, cfg.tanks, cfg.automation) !== baseline
  );

  // Reload / tab close.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // In-app navigation. The QUAY LẠI pill is intercepted through PageShell's
  // function form of `onBack`, but the chrome's home button and the user bar's
  // links are plain <Link>s owned by other files — catching their click in the
  // capture phase while this page is dirty is the only guard available from
  // here. Installed only while there is something to lose, removed on unmount.
  useEffect(() => {
    if (!dirty) return undefined;
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      let url;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingNav(url.pathname + url.search);
      setConfirming('leave');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty]);

  // The confirm panel is a real modal: it takes focus when it opens, keeps Tab
  // inside itself, closes on Escape and hands focus back to the control that
  // opened it.
  useEffect(() => {
    if (!confirming) return undefined;
    const node = dialogRef.current;
    node?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setConfirming(null);
        setPendingNav(null);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = node.querySelectorAll('button:not([disabled])');
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [confirming]);

  if (!cfg || !form) {
    return (
      <PageShell title="SETTINGS" onBack="/menu" connected={online}>
        <div className="set-page">
          <div className="set-panel set-loading" role={msg?.kind === 'err' ? 'alert' : 'status'}>
            {msg?.kind === 'err' ? msg.text : 'Đang tải cấu hình…'}
          </div>
        </div>
      </PageShell>
    );
  }

  // Drop the errors a change has just made untrue, without inventing new ones
  // mid-keystroke: fixing one half of a MIN/MAX pair must clear BOTH halves.
  const pruneErrors = (fresh) =>
    setErrors((prev) => {
      let changed = false;
      const out = { ...prev };
      for (const k of Object.keys(prev)) {
        if (prev[k] && !fresh[k]) {
          out[k] = undefined;
          changed = true;
        }
      }
      return changed ? out : prev;
    });

  const setField = (key, value) => {
    const next = { ...form, [key]: value };
    setForm(next);
    pruneErrors(validateSettingsForm(next, cfg.tanks, cfg.automation));
  };

  const setTank = (id, patch) => {
    const tanks = { ...cfg.tanks, [id]: { ...cfg.tanks[id], ...patch } };
    setCfg((c) => ({ ...c, tanks }));
    pruneErrors(validateSettingsForm(form, tanks, cfg.automation));
  };

  const setRule = (dev, patch) => {
    const automation = {
      ...cfg.automation,
      [dev]: { ...DEFAULT_RULE, ...cfg.automation[dev], ...patch },
    };
    setCfg((c) => ({ ...c, automation }));
    pruneErrors(validateSettingsForm(form, cfg.tanks, automation));
  };

  const save = async () => {
    const errs = validateSettingsForm(form, cfg.tanks, cfg.automation);
    setErrors(errs);
    if (Object.keys(errs).some((k) => errs[k])) {
      setMsg({ kind: 'err', text: 'Chưa lưu — hãy sửa các ô đang được đánh dấu đỏ.' });
      setScrollTick((t) => t + 1);
      return;
    }

    const num = (key) => commit(form[key]);
    const payload = {
      thresholds: {
        ...cfg.thresholds,
        phMin: num('phMin'),
        phMax: num('phMax'),
        // Back to storage units — never a hand-rolled /1000 or *1000.
        ecMin: ecFromMs(form.ecMin),
        ecMax: ecFromMs(form.ecMax),
        tempMin: num('tempMin'),
        tempMax: num('tempMax'),
        humidityMin: num('humidityMin'),
        humidityMax: num('humidityMax'),
        nMin: num('nMin'),
        pMin: num('pMin'),
        kMin: num('kMin'),
        tankLowPct: num('tankLowPct'),
      },
      irrigation: { runMinutes: num('runMinutes'), restMinutes: num('restMinutes') },
      // The drafts hold text; storage wants numbers, and EC rules go back
      // through metrics.js rather than a hand-rolled factor.
      tanks: Object.fromEntries(
        TANK_IDS.map((id) => {
          const t = cfg.tanks[id] || {};
          return [
            id,
            {
              ...t,
              name: t.name || '',
              enabled: t.enabled !== false,
              emptyCm: commit(t.emptyCm),
              fullCm: commit(t.fullCm),
            },
          ];
        })
      ),
      automation: Object.fromEntries(
        Object.entries(cfg.automation).map(([dev, r]) => [
          dev,
          { enabled: Boolean(r.enabled), metric: r.metric, op: r.op, value: ruleStored(r) },
        ])
      ),
    };

    setBusy(true);
    setMsg(null);
    try {
      const saved = await api.updateConfig(payload);
      // The server response wins, but keep any section it echoes back empty.
      applyConfig({ ...payload, ...(saved || {}) });
      setMsg({ kind: 'ok', text: 'Đã lưu cài đặt ngưỡng, thời gian tưới, hiệu chuẩn bồn và luật AUTO.' });
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lưu thất bại: ' + e.message });
      setScrollTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  };

  const openConfirm = (kind) => (e) => {
    triggerRef.current = e.currentTarget;
    setConfirming(kind);
  };

  const closeConfirm = () => {
    setConfirming(null);
    setPendingNav(null);
    triggerRef.current?.focus();
  };

  const runSystemAction = async (kind) => {
    setConfirming(null);
    setSysBusy(kind);
    setSysMsg(null);
    try {
      if (kind === 'restart') {
        await callApi('restartSystem');
        setSysMsg({
          kind: 'ok',
          text: 'Đã xếp lệnh khởi động lại — node điều khiển sẽ nhận ở lần kết nối kế tiếp rồi tự khởi động lại.',
        });
      } else {
        const restored = await callApi('restoreDefaults');
        const next = restored && restored.thresholds ? restored : await api.getConfig();
        applyConfig(next);
        setSysMsg({ kind: 'ok', text: 'Đã khôi phục cài đặt gốc và nạp lại vào biểu mẫu.' });
        setMsg(null);
      }
    } catch (e) {
      // Never surface a bare exception on a Vietnamese-only panel: say which
      // action failed, then the reason.
      const lead =
        kind === 'restart'
          ? 'Không gửi được lệnh khởi động lại: '
          : 'Không khôi phục được cài đặt gốc: ';
      setSysMsg({ kind: 'err', text: lead + e.message });
    } finally {
      setSysBusy(null);
    }
  };

  // QUAY LẠI and the chrome's home button both land here while the page is
  // dirty; PageShell renders a <button> for the function form of `onBack`.
  const leaveTo = (path) => {
    if (dirty) {
      triggerRef.current = document.activeElement;
      setPendingNav(path);
      setConfirming('leave');
    } else {
      navigate(path);
    }
  };

  const confirmLeave = () => {
    const to = pendingNav || '/menu';
    setConfirming(null);
    setPendingNav(null);
    // Programmatic navigation, so the capture-phase link guard never sees it.
    navigate(to);
  };

  const saveButton = (
    <button
      className="set-save"
      onClick={save}
      disabled={busy}
      title={dirty ? 'Có thay đổi chưa lưu' : undefined}
    >
      <span className="set-save-icon">
        <IconSave size={22} />
      </span>
      {/* The design reads "LƯU CÀI ĐẶT NGƯỠNG", but this button also writes the
          timings, the tank calibration and the AUTO rules. */}
      {busy ? 'ĐANG LƯU…' : 'LƯU CÀI ĐẶT'}
    </button>
  );

  return (
    <PageShell
      title="SETTINGS"
      onBack={() => leaveTo('/menu')}
      connected={online}
      actions={saveButton}
    >
      <div className="set-page">
        <div className="set-grid">
          {/* ---- Ngưỡng cảnh báo -------------------------------------- */}
          <section className="set-panel">
            <header className="set-head">
              <span className="set-head-icon">
                <IconGear size={22} />
              </span>
              <h2>CÀI ĐẶT NGƯỠNG</h2>
            </header>

            <div className="set-thr-grid">
              {THRESHOLD_BOXES.map((box) => {
                const err = errors[box.min] || errors[box.max];
                return (
                  <div className="set-thr" key={box.min}>
                    <div className="set-thr-head">
                      <Glyph kind={box.glyph} tone={box.tone} />
                      <span className="set-thr-title">{box.title}</span>
                    </div>

                    <div className="set-pair">
                      <Bound
                        cap="MIN"
                        label={`Ngưỡng ${box.name} tối thiểu`}
                        value={form[box.min]}
                        bad={Boolean(errors[box.min])}
                        onChange={(v) => setField(box.min, v)}
                      />
                      <Bound
                        cap="MAX"
                        label={`Ngưỡng ${box.name} tối đa`}
                        value={form[box.max]}
                        bad={Boolean(errors[box.max])}
                        onChange={(v) => setField(box.max, v)}
                      />
                    </div>

                    {box.ec && (
                      <p className="set-thr-note">
                        Lưu vào hệ thống: {ecFromMs(form.ecMin) ?? '--'} – {ecFromMs(form.ecMax) ?? '--'}{' '}
                        {METRICS.ec.storedUnit}
                      </p>
                    )}
                    {err && (
                      <p className="set-thr-err">
                        <IconWarning size={14} />
                        {err}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---- Bơm & van -------------------------------------------- */}
          <section className="set-panel">
            <header className="set-head">
              <span className="set-head-icon set-head-icon-clock">
                <IconClock size={22} />
              </span>
              <h2>CÀI ĐẶT BƠM &amp; VAN</h2>
            </header>

            {/* The design encloses both minute rows in one faint sub-card, the
                same treatment the four threshold boxes get. */}
            <div className="set-time">
              <Minutes
                label="THỜI GIAN TƯỚI (BƠM)"
                value={form.runMinutes}
                error={errors.runMinutes}
                onChange={(v) => setField('runMinutes', v)}
              />
              <Minutes
                label="THỜI GIAN NGHỈ (SAU TƯỚI)"
                value={form.restMinutes}
                error={errors.restMinutes}
                onChange={(v) => setField('restMinutes', v)}
              />
            </div>

            <div className="set-sys">
              <button
                type="button"
                className="set-sys-btn set-sys-restart"
                onClick={openConfirm('restart')}
                disabled={sysBusy !== null}
              >
                <span className="set-sys-icon">
                  <IconRestart size={30} />
                </span>
                <span className="set-sys-text">
                  <span className="set-sys-title">
                    {sysBusy === 'restart' ? 'ĐANG GỬI LỆNH…' : 'KHỞI ĐỘNG LẠI HỆ THỐNG'}
                  </span>
                  <span className="set-sys-sub">Khởi động lại toàn bộ hệ thống</span>
                </span>
              </button>

              <button
                type="button"
                className="set-sys-btn set-sys-restore"
                onClick={openConfirm('restore')}
                disabled={sysBusy !== null}
              >
                <span className="set-sys-icon">
                  {/* Two-arrow sync, as drawn on the panel — IconRestore's clock
                      hand reads as "history", not "restore to factory". */}
                  <IconSync size={30} />
                </span>
                <span className="set-sys-text">
                  <span className="set-sys-title">
                    {sysBusy === 'restore' ? 'ĐANG KHÔI PHỤC…' : 'KHÔI PHỤC CÀI ĐẶT TRƯỚC'}
                  </span>
                  <span className="set-sys-sub">Khôi phục về cài đặt gốc của hệ thống</span>
                </span>
              </button>

              {sysMsg && (
                <div
                  className={`set-msg set-msg-sm set-msg-${sysMsg.kind}`}
                  role={sysMsg.kind === 'err' ? 'alert' : 'status'}
                >
                  <span className="set-msg-icon">
                    {sysMsg.kind === 'err' ? <IconWarning size={18} /> : <IconInfo size={18} />}
                  </span>
                  {sysMsg.text}
                </div>
              )}
            </div>
          </section>
        </div>

        {msg && (
          <div
            className={`set-msg set-msg-${msg.kind}`}
            ref={msgRef}
            role={msg.kind === 'err' ? 'alert' : 'status'}
          >
            <span className="set-msg-icon">
              {msg.kind === 'err' ? <IconWarning size={18} /> : <IconInfo size={18} />}
            </span>
            {msg.text}
          </div>
        )}

        <div className="set-stack">
          {/* ---- Hiệu chuẩn bồn nước ---------------------------------- */}
          <section className="set-panel">
            <header className="set-head">
              <span className="set-head-icon">
                <IconTanks size={22} />
              </span>
              <h2>HIỆU CHUẨN BỒN NƯỚC</h2>
            </header>
            <p className="set-note">
              Cảm biến siêu âm đo <em>khoảng cách từ đầu dò xuống mặt nước</em>. Đo thực tế 2 lần —
              lúc bồn cạn và lúc bồn đầy — rồi điền vào đây. Mức nước % ={' '}
              <code>(cạn − đo được) / (cạn − đầy) × 100</code>.
            </p>
            <div className="table-wrap set-table table-cards">
              <table>
                <thead>
                  <tr>
                    <th>Cảm biến</th>
                    <th>Tên hiển thị</th>
                    <th>Bật</th>
                    <th className="num">Khi cạn (cm)</th>
                    <th className="num">Khi đầy (cm)</th>
                    <th>Đọc hiện tại</th>
                  </tr>
                </thead>
                <tbody>
                  {TANK_IDS.map((id) => {
                    const tank = cfg.tanks[id] || {};
                    const calErr = liveErrs[`tank.${id}`];
                    const distance = latest?.[id];
                    const preview = tankLevelPct(distance, {
                      emptyCm: commit(tank.emptyCm),
                      fullCm: commit(tank.fullCm),
                    });
                    return (
                      <tr key={id}>
                        {/* data-label: ở bề ngang điện thoại mỗi hàng gập thành
                            một thẻ và hàng tiêu đề bị ẩn, nên nhãn cột phải đi
                            kèm từng ô. CSS lấy chuỗi này ra qua attr(). */}
                        <td>{METRICS[id].short}</td>
                        <td data-label="Tên hiển thị">
                          <input
                            className="set-name-input"
                            value={tank.name || ''}
                            aria-label={`Tên hiển thị ${METRICS[id].short}`}
                            onChange={(e) => setTank(id, { name: e.target.value })}
                          />
                        </td>
                        <td data-label="Bật">
                          <input
                            type="checkbox"
                            className="set-check"
                            checked={tank.enabled !== false}
                            aria-label={`Bật ${METRICS[id].short}`}
                            onChange={(e) => setTank(id, { enabled: e.target.checked })}
                          />
                        </td>
                        <td className="num" data-label="Khi cạn (cm)">
                          <input
                            type="text"
                            inputMode="decimal"
                            className={`num-input set-num-input${calErr ? ' is-bad' : ''}`}
                            value={tank.emptyCm ?? ''}
                            aria-label={`${METRICS[id].short} khi cạn`}
                            aria-invalid={calErr ? true : undefined}
                            onChange={(e) => setTank(id, { emptyCm: e.target.value })}
                          />
                        </td>
                        <td className="num" data-label="Khi đầy (cm)">
                          <input
                            type="text"
                            inputMode="decimal"
                            className={`num-input set-num-input${calErr ? ' is-bad' : ''}`}
                            value={tank.fullCm ?? ''}
                            aria-label={`${METRICS[id].short} khi đầy`}
                            aria-invalid={calErr ? true : undefined}
                            onChange={(e) => setTank(id, { fullCm: e.target.value })}
                          />
                        </td>
                        <td className="set-preview" data-label="Đọc hiện tại">
                          {calErr ? (
                            <span className="set-preview-bad">
                              <IconWarning size={14} />
                              {calErr}
                            </span>
                          ) : distance == null ? (
                            'Không có tín hiệu'
                          ) : preview == null ? (
                            'Chưa hiệu chuẩn'
                          ) : (
                            `${fmtValue(distance, id)} cm → ${preview}%`
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* metricStatus() also reads these four, and the design's card has
                no box for any of them — without this row the page that owns
                configuration cannot change a third of the thresholds. */}
            <h3 className="set-sub-head">NGƯỠNG DINH DƯỠNG &amp; CẢNH BÁO BỒN CẠN</h3>
            <p className="set-note">
              Bỏ trống nghĩa là <em>không đặt giới hạn</em>. NPK cảnh báo khi đo được thấp hơn mức
              này; bồn cảnh báo khi mức nước xuống dưới phần trăm đã đặt.
            </p>
            <div className="set-bounds">
              {EXTRA_BOUNDS.map((b) => (
                <div className="set-bound" key={b.key}>
                  <span className="set-bound-cap">{b.label}</span>
                  <div className={`set-bound-wrap${errors[b.key] ? ' is-bad' : ''}`}>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="set-bound-input"
                      value={form[b.key]}
                      aria-label={`${b.label} (${b.unit})`}
                      aria-invalid={errors[b.key] ? true : undefined}
                      onChange={(e) => setField(b.key, e.target.value)}
                    />
                    <span className="set-bound-unit">{b.unit}</span>
                  </div>
                  {errors[b.key] && (
                    <p className="set-time-err">
                      <IconWarning size={14} />
                      {errors[b.key]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ---- Luật AUTO -------------------------------------------- */}
          <section className="set-panel">
            <header className="set-head">
              <span className="set-head-icon">
                <IconAuto size={22} />
              </span>
              <h2>LUẬT TỰ ĐỘNG (CHẾ ĐỘ AUTO)</h2>
            </header>
            <p className="set-note">
              Khi ở chế độ AUTO, mỗi lần có dữ liệu mới hệ thống sẽ BẬT thiết bị nếu điều kiện đúng,
              ngược lại TẮT — rồi đẩy lệnh xuống node điều khiển.
            </p>
            <div className="table-wrap set-table table-cards">
              <table>
                <thead>
                  <tr>
                    <th>Thiết bị</th>
                    <th>Bật luật</th>
                    <th>Cảm biến</th>
                    <th>Điều kiện</th>
                    <th className="num">Ngưỡng</th>
                    <th>Diễn giải</th>
                  </tr>
                </thead>
                <tbody>
                  {ruleIds.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty">
                        Chưa có thiết bị nào được khai báo.
                      </td>
                    </tr>
                  )}
                  {ruleIds.map((dev) => {
                    const rule = { ...DEFAULT_RULE, ...(cfg.automation[dev] || {}) };
                    const m = METRICS[rule.metric];
                    const ruleErr = liveErrs[`rule.${dev}`];
                    const stored = ruleStored(rule);
                    return (
                      <tr key={dev}>
                        <td>{deviceName(dev)}</td>
                        <td data-label="Bật luật">
                          <input
                            type="checkbox"
                            className="set-check"
                            checked={Boolean(rule.enabled)}
                            aria-label={`Bật luật cho ${deviceName(dev)}`}
                            onChange={(e) => setRule(dev, { enabled: e.target.checked })}
                          />
                        </td>
                        <td data-label="Cảm biến">
                          <select
                            className="set-select"
                            value={rule.metric}
                            aria-label={`Cảm biến cho ${deviceName(dev)}`}
                            onChange={(e) => setRule(dev, { metric: e.target.value })}
                          >
                            {AUTOMATION_METRIC_GROUPS.map((g) => (
                              <optgroup key={g.label} label={g.label}>
                                {g.keys.map((k) => (
                                  <option key={k} value={k}>
                                    {METRICS[k].label}
                                    {METRICS[k].unit ? ` (${METRICS[k].unit})` : ''}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        <td data-label="Điều kiện">
                          <select
                            value={rule.op}
                            aria-label={`Điều kiện cho ${deviceName(dev)}`}
                            onChange={(e) => setRule(dev, { op: e.target.value })}
                          >
                            <option value="below">nhỏ hơn (&lt;)</option>
                            <option value="above">lớn hơn (&gt;)</option>
                          </select>
                        </td>
                        <td className="num" data-label="Ngưỡng">
                          {/* Typed in the metric's DISPLAY unit — mS/cm for EC —
                              and held as text so clearing the box does not
                              rewrite the rule to "< 0". */}
                          <input
                            type="text"
                            inputMode="decimal"
                            className={`num-input set-num-input${ruleErr ? ' is-bad' : ''}`}
                            value={rule.value}
                            aria-label={`Ngưỡng cho ${deviceName(dev)}${m?.unit ? ` (${m.unit})` : ''}`}
                            aria-invalid={ruleErr ? true : undefined}
                            onChange={(e) => setRule(dev, { value: e.target.value })}
                          />
                        </td>
                        {/* Bọc trong <span> chứ không để fragment trần: ở bố cục
                            thẻ trên điện thoại ô này là một lưới hai cột, mà
                            fragment nhiều con sẽ bị tách thành nhiều ô lưới rời
                            nhau thay vì một câu liền mạch. */}
                        <td className="set-rule-desc" data-label="Diễn giải">
                          {ruleErr ? (
                            <span className="set-preview-bad">
                              <IconWarning size={14} />
                              {ruleErr}
                            </span>
                          ) : (
                            <span>
                              BẬT khi <strong>{m?.label || rule.metric}</strong>{' '}
                              {rule.op === 'below' ? '<' : '>'} {fmtValue(stored, rule.metric)}
                              {m?.unit ? ` ${m.unit}` : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {confirming && (
        <div className="set-modal" onMouseDown={(e) => e.target === e.currentTarget && closeConfirm()}>
          <div
            className="set-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="set-confirm-title"
            aria-describedby="set-confirm-text"
            tabIndex={-1}
            ref={dialogRef}
          >
            <span className="set-confirm-icon">
              <IconWarning size={26} />
            </span>
            <h2 className="set-confirm-title" id="set-confirm-title">
              {CONFIRM_TITLE[confirming]}
            </h2>
            <p className="set-confirm-text" id="set-confirm-text">
              {CONFIRM_TEXT[confirming]}
            </p>
            <div className="set-confirm-actions">
              <button type="button" className="set-btn-sm" onClick={closeConfirm}>
                {confirming === 'leave' ? 'Ở lại trang' : 'Huỷ'}
              </button>
              <button
                type="button"
                className="set-btn-sm set-btn-danger"
                onClick={confirming === 'leave' ? confirmLeave : () => runSystemAction(confirming)}
              >
                {confirming === 'leave' ? 'Rời trang, bỏ thay đổi' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

// Round tinted glyph that opens each threshold box. "EC" is lettering rather
// than a picture on the panel, so it stays lettering here.
function Glyph({ kind, tone }) {
  return (
    <span className={`set-glyph set-tone-${tone}`} aria-hidden="true">
      {kind === 'ec' ? (
        <span className="set-glyph-ec">EC</span>
      ) : kind === 'temp' ? (
        <IconTemperature size={20} />
      ) : kind === 'humidity' ? (
        <IconHumidityPct size={20} />
      ) : (
        <IconHumidity size={20} />
      )}
    </span>
  );
}

function Bound({ cap, label, value, bad, onChange }) {
  return (
    <div className="set-field">
      <span className="set-cap">{cap}</span>
      {/* type="text" + inputMode="decimal": a number input reports '' for any
          intermediate Chrome cannot parse ("10.", "1e"), which destroys the box
          mid-keystroke. The value is parsed once, in validate/save. */}
      <input
        type="text"
        inputMode="decimal"
        className={`set-input${bad ? ' is-bad' : ''}`}
        value={value}
        aria-label={label}
        aria-invalid={bad || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Minutes({ label, value, error, onChange }) {
  return (
    <div className="set-time-row">
      <span className="set-glyph set-tone-purple" aria-hidden="true">
        <IconClock size={20} />
      </span>
      <span className="set-time-label">{label}</span>
      <div className="set-time-control">
        <div className={`set-time-input-wrap${error ? ' is-bad' : ''}`}>
          <input
            type="text"
            inputMode="numeric"
            className="set-time-input"
            value={value}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="set-time-unit">phút</span>
        </div>
        {error && (
          <p className="set-time-err">
            <IconWarning size={14} />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
