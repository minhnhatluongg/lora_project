import { useFarm } from '../useFarm.js';
import { PageShell } from '../components/PageShell.jsx';
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

// The DASHBOARD page: two rows of HMI cards above the fold, then the deeper
// analysis panels (charts, system status, NPK, history, alerts) below them.
export function Dashboard() {
  const farm = useFarm();
  const { status, connected, latest, thresholds, tanks, loading, error } = farm;
  const sensor = status?.sensorStatus ? SENSOR_STATUS_TEXT[status.sensorStatus] : null;

  return (
    <PageShell title="DASHBOARD" onBack="/menu" connected={connected}>
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
        </>
      )}
    </PageShell>
  );
}
