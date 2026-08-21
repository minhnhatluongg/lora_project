import { useCallback, useEffect, useRef, useState } from 'react';
import { useFarm } from '../useFarm.js';
import { api } from '../api.js';
import { PageShell } from '../components/PageShell.jsx';
import { LinkQualityPanel } from '../components/LinkQualityPanel.jsx';
import { CommandTimeline } from '../components/CommandTimeline.jsx';
import { OverviewCards } from '../components/OverviewCards.jsx';
import { SystemCards } from '../components/SystemCards.jsx';
import { RealtimeCharts } from '../components/RealtimeCharts.jsx';
import { StatusPanel } from '../components/StatusPanel.jsx';
import { NpkPanel } from '../components/NpkPanel.jsx';
import { RecentTable } from '../components/RecentTable.jsx';
import { AlertsList } from '../components/AlertsList.jsx';
import { TimeAgo } from '../components/TimeAgo.jsx';
import { IconWarning } from '../components/Icons.jsx';
import { SENSOR_STATUS_TEXT, STATUS_COLOR } from '../metrics.js';
import './Dashboard.css';

// Nút "Lấy dữ liệu ngay", đặt cạnh tiêu đề đúng chỗ nút LoRa trên màn Nextion.
//
// STM32 chỉ phát khi được hỏi, nên bình thường phải chờ hết vòng hỏi mới thấy số
// mới. Nút này xin một gói đo ngay lập tức — cùng việc mà nút b2 dưới tủ làm.
//
// Lệnh đi qua hàng đợi rồi mới tới ESP32, và còn một chặng LoRa nữa mới có số
// về, nên không thể báo "xong" ngay lúc bấm. Thay vào đó nút tự khoá một nhịp
// ngắn để không ai bấm dồn, và nói thật là đang chờ.
function FetchNowButton() {
  const [state, setState] = useState('idle'); // idle | sending | waiting | error
  const [msg, setMsg] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const press = useCallback(async () => {
    if (state === 'sending' || state === 'waiting') return;
    setState('sending');
    setMsg(null);
    try {
      await api.fetchNow();
      setState('waiting');
      setMsg('Đã gửi yêu cầu — đang chờ node cảm biến trả về…');
      timer.current = setTimeout(() => {
        setState('idle');
        setMsg(null);
      }, 8000);
    } catch (e) {
      setState('error');
      setMsg(e.message || 'Không gửi được yêu cầu');
      timer.current = setTimeout(() => setState('idle'), 5000);
    }
  }, [state]);

  const busy = state === 'sending' || state === 'waiting';

  return (
    <div className="dash-fetch">
      <button
        type="button"
        className={`dash-fetch-btn${busy ? ' is-busy' : ''}`}
        onClick={press}
        disabled={busy}
        aria-busy={busy || undefined}
        title="Xin node cảm biến gửi số đo mới ngay, không chờ vòng hỏi kế tiếp"
      >
        <span className="dash-fetch-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
               stroke="currentColor" strokeWidth="2.1"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4" />
            <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" />
          </svg>
        </span>
        <span>{state === 'sending' ? 'Đang gửi…' : busy ? 'Đang chờ…' : 'Lấy dữ liệu'}</span>
      </button>
      {msg && (
        <p className={`dash-fetch-msg${state === 'error' ? ' is-bad' : ''}`} role="status">
          {msg}
        </p>
      )}
    </div>
  );
}

// The DASHBOARD page: two rows of HMI cards above the fold, then the deeper
// analysis panels (charts, system status, NPK, history, alerts) below them.
export function Dashboard() {
  const farm = useFarm();
  const { status, connected, latest, thresholds, tanks, loading, error } = farm;
  const sensor = status?.sensorStatus ? SENSOR_STATUS_TEXT[status.sensorStatus] : null;

  return (
    <PageShell
      title="DASHBOARD"
      onBack="/menu"
      connected={connected}
      titleAction={<FetchNowButton />}
    >
      {loading ? (
        <p className="panel dash-loading">Đang tải dữ liệu…</p>
      ) : (
        <>
          {error && (
            <div className="form-msg error dash-error">
              <IconWarning size={20} />
              <span>Không tải được dữ liệu: {error}</span>
            </div>
          )}

          <OverviewCards latest={latest} thresholds={thresholds} />

          <SystemCards latest={latest} tanks={tanks} thresholds={thresholds} />

          <p className="dash-footnote">
            <span>
              Node STM32 · đầu dò đất RS485 + cảm biến không khí/mưa + 4 cảm biến siêu âm
            </span>
            <span>·</span>
            <span>
              {latest?.created_at ? (
                <>
                  cập nhật <TimeAgo iso={latest.created_at} />
                </>
              ) : (
                'chưa có dữ liệu'
              )}
            </span>
            {sensor && sensor.level !== 'ok' && (
              <>
                <span>·</span>
                <strong style={{ color: STATUS_COLOR[sensor.level] }}>
                  RS485: {sensor.text}
                </strong>
              </>
            )}
          </p>

          <div className="dash-more">
            <h2>Phân tích chi tiết</h2>
            <span>Charts &amp; history</span>
          </div>

          <section className="dash-grid">
            <RealtimeCharts
              history={farm.history}
              hours={farm.hours}
              onHoursChange={farm.setHours}
            />
            <div>
              <StatusPanel status={status} latest={latest} connected={connected} />
              <NpkPanel latest={latest} thresholds={thresholds} />
            </div>
          </section>

          <section className="dash-grid dash-grid-even">
            <RecentTable rows={farm.recent} />
            <AlertsList alerts={farm.alerts} />
          </section>

          {/* Hai bảng chẩn đoán. Cả hai chỉ đọc dữ liệu đã nằm sẵn trong CSDL
              từ trước mà chưa màn hình nào dùng tới: cường độ sóng của từng
              gói, và bốn mốc thời gian của từng lệnh. Đặt cuối trang vì đây là
              phần đọc khi đi tìm nguyên nhân, không phải phần liếc hằng ngày. */}
          <section className="dash-grid dash-grid-even">
            <LinkQualityPanel />
            <CommandTimeline />
          </section>
        </>
      )}
    </PageShell>
  );
}
