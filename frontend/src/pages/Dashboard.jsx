import { useFarm } from '../useFarm.js';
import { useAuth, can } from '../auth/AuthContext.jsx';
import { PanelHeader } from '../components/PanelHeader.jsx';
import { OverviewCards } from '../components/OverviewCards.jsx';
import { SystemCards } from '../components/SystemCards.jsx';
import { RealtimeCharts } from '../components/RealtimeCharts.jsx';
import { DeviceControl } from '../components/DeviceControl.jsx';
import { StatusPanel } from '../components/StatusPanel.jsx';
import { NpkPanel } from '../components/NpkPanel.jsx';
import { RecentTable } from '../components/RecentTable.jsx';
import { AlertsList } from '../components/AlertsList.jsx';
import { TimeAgo } from '../components/TimeAgo.jsx';
import { SENSOR_STATUS_TEXT } from '../metrics.js';

export function Dashboard() {
  const farm = useFarm();
  const { user } = useAuth();
  const { status, connected, latest, thresholds, tanks, loading, error } = farm;
  const readOnly = !can.control(user.role);
  const sensor = status?.sensorStatus ? SENSOR_STATUS_TEXT[status.sensorStatus] : null;

  if (loading) return <div className="panel">Đang tải dữ liệu…</div>;

  return (
    <>
      <PanelHeader connected={connected} />

      {error && <div className="form-msg error">⚠ Không tải được dữ liệu: {error}</div>}

      <OverviewCards latest={latest} thresholds={thresholds} />

      <SystemCards
        devices={farm.devices}
        status={status}
        latest={latest}
        tanks={tanks}
        thresholds={thresholds}
      />

      <p className="panel-footnote">
        Node STM32 · đầu dò đất RS485 + 4 cảm biến siêu âm ·{' '}
        {latest?.created_at ? (
          <>cập nhật <TimeAgo iso={latest.created_at} /></>
        ) : (
          'chưa có dữ liệu'
        )}
        {sensor && sensor.level !== 'ok' && (
          <> · <strong>RS485: {sensor.text}</strong></>
        )}
      </p>

      <section className="grid-2">
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

      <DeviceControl
        devices={farm.devices}
        mode={status?.mode}
        readOnly={readOnly}
        onToggle={farm.toggleDevice}
        onSetMode={farm.setMode}
      />

      <section className="grid-2">
        <RecentTable rows={farm.recent} />
        <AlertsList alerts={farm.alerts} />
      </section>
    </>
  );
}
