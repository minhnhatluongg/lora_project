import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageShell } from '../components/PageShell.jsx';
import {
  IconGear,
  IconValve,
  IconPump,
  IconSliders,
  IconAuto,
  IconLock,
  IconWarningSolid,
} from '../components/Icons.jsx';
import { api } from '../api.js';
import { socket, EVENTS } from '../socket.js';
import { DEVICE_IDS, DEVICE_LABEL } from '../metrics.js';
import { useAuth, can } from '../auth/AuthContext.jsx';
import './Control.css';

// The ESP32 polls for queued commands, so a press is never instant: the switch
// shows the state it is travelling to until the confirming 'devices' broadcast
// lands, and gives up after this long.
const PENDING_MS = 10000;
// How long "Đã huỷ lệnh" stays on a cell after an in-flight press is undone.
const CANCEL_MS = 2500;
// Emergency stop is a two-stage press; the first press stays armed this long.
const ARM_SECONDS = 5;

const omit = (obj, key) => {
  if (!(key in obj)) return obj;
  const next = { ...obj };
  delete next[key];
  return next;
};

// ---------------------------------------------------------------------------

function Panel({ icon, title, children, footer, grow = false }) {
  return (
    <section className={`ctrl-panel${grow ? ' ctrl-panel-grow' : ''}`}>
      <div className="ctrl-head">
        <div className="ctrl-head-inner">
          <span className="ctrl-head-icon">{icon}</span>
          <h2>{title}</h2>
        </div>
      </div>
      {children}
      {footer}
    </section>
  );
}

function ModeTile({ id, label, glyph, selected, busy, disabled, onSelect }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-busy={busy || undefined}
      className={`ctrl-mode${selected ? ' is-on' : ''}${busy ? ' is-busy' : ''}`}
      disabled={disabled || busy}
      onClick={() => onSelect(id)}
    >
      <span className="ctrl-mode-radio" aria-hidden="true" />
      <span className="ctrl-mode-glyph">{glyph}</span>
      <span className="ctrl-mode-label">{label}</span>
    </button>
  );
}

// One actuator: caption, coloured line glyph, then the OFF/ON rocker.
//
// `inhibited` means the emergency-stop latch is closed. The server has queued
// OFF for every actuator but the relay board only applies that on its next
// poll, so a cell may honestly still read ON for a few seconds — that is an
// ABNORMAL condition, not a healthy running output, and it is drawn as one.
function DeviceCell({ device, kind, disabled, inhibited, pending, problem, hint, onToggle }) {
  const shown = pending || device.state;
  const on = shown === 'ON';
  const unknown = shown !== 'ON' && shown !== 'OFF';
  const Icon = kind === 'pump' ? IconPump : IconValve;
  const cutting = inhibited && on;

  let note = '';
  let tone = '';
  if (pending) note = 'Đang gửi lệnh…';
  else if (problem) {
    note = problem;
    tone = ' is-bad';
  } else if (hint) note = hint;
  else if (device.missing) {
    note = 'Không có thiết bị';
    tone = ' is-bad';
  } else if (cutting) {
    note = 'ĐANG CẮT NGUỒN';
    tone = ' is-bad';
  } else if (inhibited) note = 'Đã cắt';

  const noteId = `${device.id}-note`;
  const locked = disabled && !unknown;

  return (
    <div
      className={`ctrl-dev ctrl-dev-${kind}${on && !inhibited ? ' is-on' : ''}${
        cutting ? ' is-cutting' : ''
      }${inhibited ? ' is-inhibited' : ''}`}
    >
      <span className="ctrl-dev-name">{device.name}</span>
      <span className="ctrl-dev-icon" aria-hidden="true">
        <Icon />
      </span>
      <button
        type="button"
        role="switch"
        /* ARIA carries the CONFIRMED state; the optimistic `shown` is a visual
           only. aria-busy + the described note say "not acknowledged yet". */
        aria-checked={device.state === 'ON'}
        aria-busy={pending ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        aria-label={unknown ? `${device.name}: không rõ trạng thái` : device.name}
        className={`ctrl-switch${on ? ' is-on' : ' is-off'}${unknown ? ' is-unknown' : ''}${
          pending ? ' is-pending' : ''
        }`}
        disabled={disabled || unknown}
        onClick={() => onToggle(device, shown)}
      >
        <span className="ctrl-switch-label">{unknown ? '--' : on ? 'ON' : 'OFF'}</span>
        <span className="ctrl-switch-knob" aria-hidden="true">
          {locked ? <IconLock /> : null}
        </span>
      </button>
      <span id={noteId} className={`ctrl-dev-note${tone}`}>
        {note}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Control() {
  const { user } = useAuth();
  const readOnly = !can.control(user?.role);

  const [devices, setDevices] = useState([]);
  const [status, setStatus] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [pending, setPending] = useState({}); // deviceId -> target state
  const [problems, setProblems] = useState({}); // deviceId -> warning
  const [hints, setHints] = useState({}); // deviceId -> neutral note
  const [modeBusy, setModeBusy] = useState(null);
  const [modeError, setModeError] = useState(null);

  const [armed, setArmed] = useState(0); // seconds left on the e-stop arm
  const [estopBusy, setEstopBusy] = useState(false);
  const [estopError, setEstopError] = useState(null);

  const timers = useRef({});
  const lastStates = useRef({});

  // applyDevices runs from a socket callback, so it needs the current pending
  // map without being re-created (and re-subscribed) on every press.
  const pendingRef = useRef({});
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const clearTimer = useCallback((id) => {
    const t = timers.current[id];
    if (t) {
      clearTimeout(t);
      delete timers.current[id];
    }
  }, []);

  // Every devices broadcast is a chance to retire a pending press. A press is
  // finished either because the actuator CHANGED state, or because the
  // broadcast already AGREES with where we were travelling — the second case
  // is what happens when something else (the e-stop, an AUTO rule, another
  // operator) got there first, and without it an optimistic 'ON' would keep a
  // switch green for the full timeout on a device the field has already cut.
  const applyDevices = useCallback(
    (list) => {
      const arr = Array.isArray(list) ? list : [];
      const moved = [];
      for (const d of arr) {
        const before = lastStates.current[d.id];
        const changed = before !== undefined && before !== d.state;
        const arrived = pendingRef.current[d.id] === d.state;
        if (changed || arrived) moved.push(d.id);
        lastStates.current[d.id] = d.state;
      }
      setDevices(arr);
      if (!moved.length) return;
      moved.forEach(clearTimer);
      const drop = (prev) => {
        let next = prev;
        for (const id of moved) {
          if (id in next) {
            if (next === prev) next = { ...prev };
            delete next[id];
          }
        }
        return next;
      };
      setPending(drop);
      setProblems(drop);
      setHints(drop);
    },
    [clearTimer]
  );

  // A failure on one endpoint must not blank the other, hence allSettled.
  const load = useCallback(async () => {
    const [dRes, sRes] = await Promise.allSettled([api.devices(), api.status()]);
    if (dRes.status === 'fulfilled') applyDevices(dRes.value);
    if (sRes.status === 'fulfilled') setStatus(sRes.value);
    const failed = [dRes, sRes].find((r) => r.status === 'rejected');
    setError(failed ? failed.reason?.message || 'Không tải được dữ liệu' : null);
    setLoading(false);
  }, [applyDevices]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates. A reconnect means we were deaf for a while, so re-pull.
  const firstConnect = useRef(!socket.connected);
  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      if (!firstConnect.current) load();
      firstConnect.current = false;
    };
    const onDisconnect = () => setConnected(false);
    const onDevices = (list) => applyDevices(list);
    const onStatus = (s) => setStatus(s);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(EVENTS.DEVICES, onDevices);
    socket.on(EVENTS.STATUS, onStatus);

    // The handshake can complete between this component's first render and
    // this subscription, in which case 'connect' already fired and will never
    // fire again for that link — the lamp would stay red forever on a page
    // that is receiving events. Re-read the socket now that we are listening.
    // A socket that is already up means the NEXT 'connect' is a real reconnect.
    setConnected(socket.connected);
    if (socket.connected) firstConnect.current = false;

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(EVENTS.DEVICES, onDevices);
      socket.off(EVENTS.STATUS, onStatus);
    };
  }, [load, applyDevices]);

  // Drop every in-flight timeout when the page goes away.
  useEffect(
    () => () => {
      Object.values(timers.current).forEach(clearTimeout);
      timers.current = {};
    },
    []
  );

  // e-stop arm countdown
  useEffect(() => {
    if (armed <= 0) return undefined;
    const id = setTimeout(() => setArmed((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [armed]);

  const mode = String(status?.mode || '').toUpperCase();
  const estopEngaged = !!(status?.eStop ?? status?.estop);
  const estopSupported = typeof api.emergencyStop === 'function';

  // The latch closing voids every command in flight: the server queues OFF for
  // all nine actuators and refuses ON until it is released. Optimistic state
  // that survived that would show a green ON rocker on an output being cut, so
  // it is wiped the instant the latch reads engaged.
  useEffect(() => {
    if (!estopEngaged) return;
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    const empty = (prev) => (Object.keys(prev).length ? {} : prev);
    setPending(empty);
    setProblems(empty);
    setHints(empty);
  }, [estopEngaged]);

  // Why the outputs are locked, in priority order — an operator should never
  // have to guess which of the four reasons is in force. MANUAL is the only
  // state that hands over the switches; everything else, including "no mode
  // picked yet", leaves them dead.
  const lockReason = estopEngaged
    ? 'ĐANG DỪNG KHẨN CẤP — mọi bơm và van bị khoá cho tới khi giải trừ.'
    : readOnly
      ? 'Tài khoản chỉ có quyền xem — không thể điều khiển thiết bị.'
      : mode === 'AUTO'
        ? 'Đang ở chế độ TỰ ĐỘNG — chuyển sang THỦ CÔNG để bật/tắt tay.'
        : mode === 'MANUAL'
          ? null
          : !status
            ? 'Chưa đọc được chế độ từ máy chủ.'
            : 'Chưa chọn chế độ — hãy chọn THỦ CÔNG hoặc TỰ ĐỘNG ở trên.';
  const locked = !!lockReason;

  const byId = useMemo(() => {
    const map = {};
    for (const d of devices || []) map[d.id] = d;
    return map;
  }, [devices]);

  const cellsFor = useCallback(
    (ids) =>
      ids.map((id) => {
        const d = byId[id];
        return {
          id,
          name: d?.name || DEVICE_LABEL[id] || id,
          state: d?.state ?? null,
          missing: !d && !loading,
        };
      }),
    [byId, loading]
  );

  const toggleDevice = useCallback(
    async (device, shown) => {
      if (locked || device.state == null) return;
      // Reverse what the operator can SEE, not what the server last confirmed:
      // a second tap on a switch that is still travelling has to undo it.
      const current = shown === 'ON' || shown === 'OFF' ? shown : device.state;
      const target = current === 'ON' ? 'OFF' : 'ON';
      // Undoing lands back on the confirmed state, so there is nothing left to
      // wait for; the backend replaces the instruction still queued for this
      // device, so the earlier press never reaches the relay board.
      const undo = target === device.state;

      clearTimer(device.id);
      setProblems((p) => omit(p, device.id));
      setHints((h) => omit(h, device.id));

      if (undo) {
        setPending((p) => omit(p, device.id));
        setHints((h) => ({ ...h, [device.id]: 'Đã huỷ lệnh' }));
        timers.current[device.id] = setTimeout(() => {
          delete timers.current[device.id];
          setHints((h) => omit(h, device.id));
        }, CANCEL_MS);
      } else {
        setPending((p) => ({ ...p, [device.id]: target }));
        timers.current[device.id] = setTimeout(() => {
          delete timers.current[device.id];
          setPending((p) => omit(p, device.id));
          setProblems((p) => ({ ...p, [device.id]: 'Chưa phản hồi' }));
        }, PENDING_MS);
      }

      try {
        await api.sendDeviceCommand(device.id, target);
      } catch (e) {
        clearTimer(device.id);
        setPending((p) => omit(p, device.id));
        setHints((h) => omit(h, device.id));
        setProblems((p) => ({ ...p, [device.id]: e.message || 'Lỗi gửi lệnh' }));
      }
    },
    [locked, clearTimer]
  );

  const selectMode = useCallback(
    async (next) => {
      if (readOnly || modeBusy || next === mode) return;
      setModeBusy(next);
      setModeError(null);
      try {
        const s = await api.setMode(next);
        setStatus((prev) =>
          s && typeof s === 'object'
            ? { ...(prev || {}), ...s }
            : { ...(prev || {}), mode: next }
        );
      } catch (e) {
        setModeError(e.message || 'Không đổi được chế độ');
      } finally {
        setModeBusy(null);
      }
    },
    [readOnly, modeBusy, mode]
  );

  // Engaging is destructive, so it takes two presses; releasing takes one.
  const pressEstop = useCallback(async () => {
    if (estopBusy || readOnly) return;
    if (!estopSupported) {
      setEstopError('Máy chủ chưa hỗ trợ dừng khẩn cấp.');
      return;
    }
    if (!estopEngaged && armed <= 0) {
      setEstopError(null);
      setArmed(ARM_SECONDS);
      return;
    }
    setArmed(0);
    const next = !estopEngaged;
    setEstopBusy(true);
    try {
      const res = await api.emergencyStop(next);
      setStatus((prev) => {
        const base = { ...(prev || {}) };
        if (res && typeof res === 'object') {
          Object.assign(base, res);
          if (!('eStop' in res)) base.eStop = 'engaged' in res ? !!res.engaged : next;
        } else {
          base.eStop = next;
        }
        return base;
      });
      setEstopError(null);
    } catch (e) {
      setEstopError(e.message || 'Không gửi được lệnh dừng khẩn cấp');
    } finally {
      setEstopBusy(false);
    }
  }, [estopBusy, readOnly, estopSupported, estopEngaged, armed]);

  const modeNote = modeError
    ? modeError
    : estopEngaged
      ? 'Không thể bật TỰ ĐỘNG cho tới khi giải trừ dừng khẩn cấp.'
      : mode === 'AUTO'
        ? 'Đã bật toàn bộ bơm và van, sau đó hệ thống chạy theo ngưỡng trong CÀI ĐẶT.'
        : mode === 'MANUAL'
          ? 'Bạn bật/tắt từng bơm và van bằng tay.'
          : loading
            ? 'Đang đọc chế độ từ máy chủ…'
            : !status
              ? 'Chưa đọc được chế độ từ máy chủ.'
              : 'Chưa chọn chế độ — mọi bơm và van đang khoá. Chọn một chế độ để bắt đầu.';

  const estopLabel = estopEngaged
    ? 'ĐANG DỪNG KHẨN CẤP — BẤM ĐỂ GIẢI TRỪ'
    : armed > 0
      ? 'BẤM LẦN NỮA ĐỂ XÁC NHẬN'
      : 'DỪNG KHẨN CẤP';

  const estopSub = estopEngaged
    ? 'Toàn bộ bơm và van đã bị cắt. Bấm để đưa hệ thống trở lại hoạt động.'
    : armed > 0
      ? `Sẽ cắt toàn bộ bơm và van. Tự huỷ sau ${armed} giây.`
      : readOnly
        ? 'Tài khoản chỉ có quyền xem — không thể dừng khẩn cấp.'
        : !estopSupported
          ? 'Máy chủ chưa hỗ trợ chức năng này.'
          : null;

  // Rendered once, under the BƠM panel: the same sentence under both device
  // panels was the page's only duplicated copy and cost height it cannot pay.
  const deviceFooter = (
    <p className={`ctrl-note${locked ? ' is-lock' : ''}`}>
      {locked && (
        <span className="ctrl-note-icon" aria-hidden="true">
          <IconLock />
        </span>
      )}
      {lockReason || 'Chạm công tắc để bật/tắt. Lệnh được gửi xuống ESP32 ở lần hỏi kế tiếp.'}
    </p>
  );

  return (
    <PageShell title="CONTROL" onBack="/menu" connected={connected}>
      {error && (
        <p className="ctrl-error" role="alert">
          {error}
        </p>
      )}

      {/* The latch dominates the page: whatever the device list says, every
          output is being cut and nothing on this screen may be switched on. */}
      {estopEngaged && (
        <div className="ctrl-inhibit" role="alert">
          <span className="ctrl-inhibit-icon" aria-hidden="true">
            <IconWarningSolid />
          </span>
          <strong>ĐẦU RA BỊ CẮT</strong>
          <span>Đang DỪNG KHẨN CẤP — toàn bộ bơm và van bị khoá cho tới khi giải trừ.</span>
        </div>
      )}

      <div className={`ctrl-grid${estopEngaged ? ' is-inhibited' : ''}`}>
        <div className="ctrl-col">
          <Panel icon={<IconGear />} title="Chế độ hoạt động">
            <div className="ctrl-modes" role="radiogroup" aria-label="Chế độ hoạt động">
              <ModeTile
                id="MANUAL"
                label="Thủ công"
                glyph={<IconSliders />}
                selected={mode === 'MANUAL'}
                busy={modeBusy === 'MANUAL'}
                disabled={readOnly}
                onSelect={selectMode}
              />
              <ModeTile
                id="AUTO"
                label="Tự động"
                glyph={<IconAuto />}
                selected={mode === 'AUTO'}
                busy={modeBusy === 'AUTO'}
                /* the server refuses AUTO while the latch is engaged (409), so
                   don't offer a press that can only fail */
                disabled={readOnly || estopEngaged}
                onSelect={selectMode}
              />
            </div>
            <p className={`ctrl-note${modeError ? ' is-bad' : ''}`}>{modeNote}</p>
          </Panel>

          <Panel grow icon={<IconValve />} title="Điều khiển thiết bị - Van">
            <div className="ctrl-devices ctrl-devices-van">
              {cellsFor(DEVICE_IDS.valves).map((d) => (
                <DeviceCell
                  key={d.id}
                  device={d}
                  kind="van"
                  disabled={locked}
                  inhibited={estopEngaged}
                  pending={pending[d.id]}
                  problem={problems[d.id]}
                  hint={hints[d.id]}
                  onToggle={toggleDevice}
                />
              ))}
            </div>
          </Panel>
        </div>

        <div className="ctrl-col">
          <Panel
            grow
            icon={<IconPump />}
            title="Điều khiển thiết bị - Bơm"
            footer={deviceFooter}
          >
            <div className="ctrl-devices ctrl-devices-pump">
              {cellsFor(DEVICE_IDS.pumps).map((d) => (
                <DeviceCell
                  key={d.id}
                  device={d}
                  kind="pump"
                  disabled={locked}
                  inhibited={estopEngaged}
                  pending={pending[d.id]}
                  problem={problems[d.id]}
                  hint={hints[d.id]}
                  onToggle={toggleDevice}
                />
              ))}
            </div>
          </Panel>

          <div className="ctrl-estop-wrap">
            <button
              type="button"
              className={`ctrl-estop${estopEngaged ? ' is-engaged' : ''}${
                armed > 0 ? ' is-armed' : ''
              }`}
              aria-pressed={estopEngaged}
              disabled={estopBusy || readOnly || !estopSupported}
              onClick={pressEstop}
            >
              <span className="ctrl-estop-icon" aria-hidden="true">
                <IconWarningSolid />
              </span>
              <span className="ctrl-estop-text">
                <strong>{estopLabel}</strong>
                {estopSub && <em>{estopSub}</em>}
              </span>
            </button>
            {estopError && (
              <p className="ctrl-note is-bad" role="alert">
                {estopError}
              </p>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

export default Control;
