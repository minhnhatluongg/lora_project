import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageShell } from '../components/PageShell.jsx';
import { api } from '../api.js';
import { useAuth, ROLE_LABEL } from '../auth/AuthContext.jsx';
import { useTaskBadge } from '../tasks/TaskBadgeContext.jsx';
import { socket, EVENTS } from '../socket.js';
import { IconTasks, IconCheck, IconBell, IconWarning, IconInfo } from '../components/Icons.jsx';
import './Tasks.css';

// Ba mức ưu tiên, viết ra thay vì để trần trong JSX để nhãn hiển thị và giá trị
// gửi lên server chỉ khai báo một chỗ.
const PRIORITIES = [
  { id: 'low', label: 'Thấp' },
  { id: 'normal', label: 'Bình thường' },
  { id: 'high', label: 'Cao' },
];

// 'new' viết là "Chưa bắt đầu" chứ không phải "Mới": nó nói về TIẾN ĐỘ, và
// "Mới" dễ bị đọc nhầm thành "vừa được giao" — hai chuyện khác nhau.
// Chữ trên chip mức ưu tiên. Không có mục 'normal': mức bình thường là mặc
// định nên không đeo chip, xem chú thích ở chỗ vẽ chip.
const PRIORITY_FLAG = { high: 'Ưu tiên cao', low: 'Ưu tiên thấp' };

const STATUS_LABEL = { new: 'Chưa bắt đầu', doing: 'Đang làm', done: 'Xong' };

// Ba khung nhìn. `assigned` và `all` chỉ hiện với vai được phép — nhưng server
// vẫn chặn lại lần nữa, ẩn tab ở đây chỉ là cho gọn mắt.
const VIEWS = [
  { id: 'mine', label: 'Việc của tôi' },
  { id: 'assigned', label: 'Tôi đã giao' },
  { id: 'all', label: 'Tất cả' },
];

const pad = (n) => String(n).padStart(2, '0');

// <input type="datetime-local"> cho ra "YYYY-MM-DDTHH:MM", server nhận
// "YYYY-MM-DD HH:MM:SS". Đổi ở đây chứ không ở chỗ gọi API, để chỉ một nơi biết
// về sự khác nhau này.
const fromInput = (v) => (v ? v.replace('T', ' ') + ':00' : null);

const parseSql = (s) => {
  if (!s) return null;
  // SQLite trả giờ UTC không kèm hậu tố; thêm 'Z' để Date khỏi hiểu nhầm là giờ
  // máy, nếu không hạn chót lệch đúng bằng múi giờ (7 tiếng ở Việt Nam).
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
};

const fmtDue = (s) => {
  const d = parseSql(s);
  if (!d) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const isOverdue = (task) =>
  task.status !== 'done' && task.dueAt && parseSql(task.dueAt) < new Date();

const personName = (p) => (p ? p.fullName || p.username : 'Không rõ');

// --- Ô nhập việc mới ---------------------------------------------------------

function NewTaskForm({ people, onCreated }) {
  const [form, setForm] = useState({ title: '', body: '', assigneeId: '', priority: 'normal', dueAt: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  // Chọn sẵn người đầu tiên khi danh sách về, để việc giao nhanh chỉ còn một ô
  // phải điền. Chỉ đặt khi đang trống, đừng ghi đè lựa chọn của người dùng.
  useEffect(() => {
    if (people.length && !form.assigneeId) {
      setForm((prev) => ({ ...prev, assigneeId: String(people[0].id) }));
    }
  }, [people, form.assigneeId]);

  const set = (key) => (e) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    setMsg(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!form.title.trim()) return setMsg({ text: 'Nhập tên công việc.', ok: false });
    if (!form.assigneeId) return setMsg({ text: 'Chọn người nhận việc.', ok: false });

    setBusy(true);
    try {
      await api.createTask({
        title: form.title.trim(),
        body: form.body.trim(),
        assigneeId: Number(form.assigneeId),
        priority: form.priority,
        dueAt: fromInput(form.dueAt),
      });
      // Giữ nguyên người nhận và mức ưu tiên: giao nhiều việc cho cùng một
      // người là chuyện thường, bắt chọn lại mỗi lần là phiền vô ích.
      setForm((prev) => ({ ...prev, title: '', body: '', dueAt: '' }));
      setMsg({ text: 'Đã giao việc.', ok: true });
      onCreated();
    } catch (err) {
      setMsg({ text: err.message || 'Không giao được việc.', ok: false });
    } finally {
      setBusy(false);
    }
  };

  if (!people.length) {
    return (
      <div className="panel task-empty-note">
        <IconInfo size={18} />
        <span>Chưa có tài khoản nào bạn được phép giao việc.</span>
      </div>
    );
  }

  return (
    <form className="panel task-new" onSubmit={submit}>
      <h3>Giao việc mới</h3>

      <label className="task-field task-field-wide">
        <span>Tên công việc</span>
        <input value={form.title} onChange={set('title')} placeholder="VD: Kiểm tra rò rỉ Van 3" maxLength={200} />
      </label>

      <label className="task-field task-field-wide">
        <span>Mô tả <em>(không bắt buộc)</em></span>
        <textarea rows={2} value={form.body} onChange={set('body')} placeholder="Chi tiết cần làm…" />
      </label>

      <label className="task-field">
        <span>Giao cho</span>
        <select value={form.assigneeId} onChange={set('assigneeId')}>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {personName(p)} — {ROLE_LABEL[p.role] || p.role}
            </option>
          ))}
        </select>
      </label>

      <label className="task-field">
        <span>Ưu tiên</span>
        <select value={form.priority} onChange={set('priority')}>
          {PRIORITIES.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>

      <label className="task-field">
        <span>Hạn chót <em>(không bắt buộc)</em></span>
        <input type="datetime-local" value={form.dueAt} onChange={set('dueAt')} />
      </label>

      <div className="task-new-foot">
        <button type="submit" className="task-btn task-btn-primary" disabled={busy}>
          {busy ? 'Đang giao…' : 'Giao việc'}
        </button>
        {msg && (
          <p className={`task-msg${msg.ok ? ' is-ok' : ' is-bad'}`} role="status">
            {msg.text}
          </p>
        )}
      </div>
    </form>
  );
}

// --- Một việc ----------------------------------------------------------------

function TaskCard({ task, me, onChanged }) {
  const [note, setNote] = useState(task.resultNote || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const mine = task.assignee?.id === me.id;
  const owner = task.assigner?.id === me.id || me.role === 'admin';
  const overdue = isOverdue(task);

  const patch = async (body) => {
    setBusy(true);
    setErr('');
    try {
      await api.updateTask(task.id, body);
      onChanged();
    } catch (e) {
      setErr(e.message || 'Không cập nhật được.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.deleteTask(task.id);
      onChanged();
    } catch (e) {
      setErr(e.message || 'Không xóa được.');
      setBusy(false);
    }
  };

  return (
    <article
      className={`task-card task-p-${task.priority}${task.status === 'done' ? ' is-done' : ''}${
        overdue ? ' is-overdue' : ''
      }`}
    >
      <header className="task-card-head">
        <h4 className="task-card-title">{task.title}</h4>
        <div className="task-flags">
          {/* KHÔNG có cờ "chưa xem" ở đây. Trạng thái `new` (chip "Chưa bắt đầu"
              bên dưới) đã nói đúng điều đó rồi, và nó bền hơn: chỉ đổi khi có
              người thật sự bắt tay vào việc. `seenAt` thì tắt ngay lúc mở trang
              nên làm cờ báo là vô dụng — nó được dùng đúng chỗ của nó, ở khung
              "Tôi đã giao", nơi người giao cần biết cấp dưới đã ngó tới chưa. */}
          {/* Mức ưu tiên KHÁC bình thường thì luôn kèm chữ. Trước đây chỉ mức
              "cao" có chip, nên "thấp" và "bình thường" chỉ khác nhau ở màu
              vạch bên trái — tức là phân biệt bằng riêng màu sắc, đúng thứ mà
              ổ khoá "Không đủ quyền" ở MENU đã cẩn thận tránh. Mức bình thường
              cố ý KHÔNG có chip: nó là mặc định, và một cái chip lặp trên mọi
              thẻ thì chẳng ai còn đọc nữa. */}
          {task.priority !== 'normal' && task.status !== 'done' && (
            <span className={`task-flag task-flag-${task.priority}`}>
              {PRIORITY_FLAG[task.priority]}
            </span>
          )}
          {/* Kèm CHỮ chứ không chỉ đổi màu: cùng quy ước với ổ khoá "Không đủ
              quyền" ở MENU, để còn đọc được trên màn hình đơn sắc. */}
          {overdue && (
            <span className="task-flag task-flag-overdue">
              <IconBell size={13} />
              Quá hạn
            </span>
          )}
          <span className={`task-flag task-status-${task.status}`}>{STATUS_LABEL[task.status]}</span>
        </div>
      </header>

      {task.body && <p className="task-card-body">{task.body}</p>}

      <dl className="task-meta">
        <div>
          <dt>Người nhận</dt>
          <dd>{personName(task.assignee)}</dd>
        </div>
        <div>
          <dt>Người giao</dt>
          <dd>{personName(task.assigner)}</dd>
        </div>
        {/* Chỉ người giao mới thấy dòng này. Người nhận đang mở trang thì hiển
            nhiên là đã xem — nói lại với họ là thừa. */}
        {!mine && (
          <div>
            <dt>Người nhận</dt>
            <dd className={task.seenAt ? '' : 'task-due-bad'}>
              {task.seenAt ? `đã xem ${fmtDue(task.seenAt)}` : 'chưa mở xem'}
            </dd>
          </div>
        )}
        {task.dueAt && (
          <div>
            <dt>Hạn chót</dt>
            <dd className={overdue ? 'task-due-bad' : ''}>{fmtDue(task.dueAt)}</dd>
          </div>
        )}
        {task.doneAt && (
          <div>
            <dt>Hoàn thành</dt>
            <dd>{fmtDue(task.doneAt)}</dd>
          </div>
        )}
      </dl>

      {task.resultNote && task.status === 'done' && (
        <p className="task-result">
          <IconCheck size={14} />
          <span>{task.resultNote}</span>
        </p>
      )}

      {/* Chỉ NGƯỜI NHẬN mới đổi được tiến độ. Người giao sửa được đề bài trong
          ô "Giao việc mới" chứ không phải ở đây — hai vai, hai việc khác nhau. */}
      {mine && task.status !== 'done' && (
        <div className="task-actions">
          {task.status === 'new' && (
            <button className="task-btn" disabled={busy} onClick={() => patch({ status: 'doing' })}>
              Bắt đầu làm
            </button>
          )}
          <input
            className="task-note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi lại kết quả…"
            aria-label={`Ghi kết quả cho việc ${task.title}`}
          />
          <button
            className="task-btn task-btn-done"
            disabled={busy}
            onClick={() => patch({ status: 'done', resultNote: note })}
          >
            <IconCheck size={15} />
            Đánh dấu xong
          </button>
        </div>
      )}

      {mine && task.status === 'done' && (
        <div className="task-actions">
          <button className="task-btn" disabled={busy} onClick={() => patch({ status: 'doing' })}>
            Mở lại
          </button>
        </div>
      )}

      {owner && (
        <div className="task-actions task-actions-owner">
          <button className="task-btn task-btn-danger" disabled={busy} onClick={remove}>
            Xóa việc
          </button>
        </div>
      )}

      {err && (
        <p className="task-msg is-bad" role="alert">
          <IconWarning size={14} />
          {err}
        </p>
      )}
    </article>
  );
}

// --- Trang -------------------------------------------------------------------

export function Tasks() {
  const { user } = useAuth();
  const { summary, refresh: refreshBadge } = useTaskBadge();
  const [view, setView] = useState('mine');
  const [showDone, setShowDone] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    // Đọc lại SAU khi đăng ký: cái bắt tay có thể xong đúng giữa lần vẽ đầu và
    // effect này, bỏ lỡ 'connect' là đèn báo kẹt ở trạng thái mất kết nối.
    setConnected(socket.connected);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const load = useCallback(async () => {
    setErr('');
    try {
      setTasks(await api.tasks({ scope: view, status: showDone ? 'all' : 'open' }));
    } catch (e) {
      setErr(e.message || 'Không tải được danh sách công việc.');
    } finally {
      setLoading(false);
    }
  }, [view, showDone]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!summary.canAssign) return undefined;
    let alive = true;
    api.assignableUsers().then(
      (list) => alive && setPeople(list),
      () => {}
    );
    return () => { alive = false; };
  }, [summary.canAssign]);

  // Ai đó đổi việc ở máy khác thì danh sách đang mở phải theo kịp.
  useEffect(() => {
    const onPing = () => load();
    socket.on(EVENTS.TASKS, onPing);
    return () => socket.off(EVENTS.TASKS, onPing);
  }, [load]);

  const afterChange = useCallback(() => {
    load();
    refreshBadge();
  }, [load, refreshBadge]);

  // Mở trang là coi như đã biết tới những việc đang hiện — tắt chấm "MỚI".
  // Chỉ đánh dấu việc của CHÍNH MÌNH và chỉ ở khung "Việc của tôi": lướt qua
  // tab "Tất cả" với vai admin thì không phải là đã đọc việc của người khác.
  const seenSent = useRef(new Set());
  useEffect(() => {
    if (view !== 'mine') return;
    const unseen = tasks.filter(
      (t) => !t.seenAt && t.assignee?.id === user.id && !seenSent.current.has(t.id)
    );
    if (!unseen.length) return;
    unseen.forEach((t) => seenSent.current.add(t.id));
    Promise.allSettled(unseen.map((t) => api.markTaskSeen(t.id))).then(refreshBadge);
  }, [tasks, view, user.id, refreshBadge]);

  const views = useMemo(
    () => VIEWS.filter((v) => (v.id === 'all' ? user.role === 'admin' : v.id !== 'assigned' || summary.canAssign)),
    [user.role, summary.canAssign]
  );

  const openCount = tasks.filter((t) => t.status !== 'done').length;

  return (
    <PageShell title="CÔNG VIỆC" onBack="/menu" connected={connected}>
      <div className="task-wrap">
        <div className="panel task-bar">
          <div className="seg task-views">
            {views.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`seg-btn ${view === v.id ? 'seg-active' : ''}`}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>

          <label className="task-toggle">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            <span>Hiện cả việc đã xong</span>
          </label>

          <span className="task-count">
            <IconTasks size={16} />
            {openCount} việc chưa xong
          </span>
        </div>

        {/* Nhắc riêng cho người GIAO: giao xong rồi thì việc rơi vào im lặng,
            không có dòng này thì họ chẳng bao giờ biết cấp dưới trễ hạn. */}
        {summary.assignedOverdue > 0 && view !== 'assigned' && (
          <button type="button" className="panel task-chase" onClick={() => setView('assigned')}>
            <IconBell size={18} />
            <span>
              <strong>{summary.assignedOverdue}</strong> việc bạn giao đã quá hạn mà chưa xong.
            </span>
            <em>Xem →</em>
          </button>
        )}

        {summary.canAssign && <NewTaskForm people={people} onCreated={afterChange} />}

        {err && (
          <p className="panel task-msg is-bad" role="alert">
            <IconWarning size={16} />
            {err}
          </p>
        )}

        {loading ? (
          <p className="panel task-empty-note">Đang tải…</p>
        ) : tasks.length === 0 ? (
          <p className="panel task-empty-note">
            <IconCheck size={18} />
            {view === 'mine'
              ? 'Bạn không có việc nào đang chờ.'
              : view === 'assigned'
                ? 'Bạn chưa giao việc nào.'
                : 'Chưa có công việc nào.'}
          </p>
        ) : (
          <div className="task-list">
            {tasks.map((t) => (
              <TaskCard key={t.id} task={t} me={user} onChanged={afterChange} />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

export default Tasks;
