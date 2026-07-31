import { useFarm } from '../useFarm.js';
import { useAuth, can } from '../auth/AuthContext.jsx';
import { MetricCards } from '../components/MetricCards.jsx';
import { NpkPanel } from '../components/NpkPanel.jsx';
import { TankLevels } from '../components/TankLevels.jsx';
import { RealtimeCharts } from '../components/RealtimeCharts.jsx';
import { DeviceControl } from '../components/DeviceControl.jsx';
import { StatusPanel } from '../components/StatusPanel.jsx';
import { RecentTable } from '../components/RecentTable.jsx';
import { AlertsList } from '../components/AlertsList.jsx';
import { TimeAgo } from '../components/TimeAgo.jsx';
import { SENSOR_STATUS_TEXT } from '../metrics.js';

function Pill({ ok, children, title }) {
  return (
    <span className={`pill ${ok ? 'pill-on' : 'pill-off'}`} title={title}>
      {children}
    </span>
  );
}

export function Dashboard() {
  const farm = useFarm();
  const { user } = useAuth();
  const { status, connected, latest, thresholds, tanks, loading, error } = farm;
  const readOnly = !can.control(user.role);
  const sensor = status?.sensorStatus ? SENSOR_STATUS_TEXT[status.sensorStatus] : null;

  if (loading) return <div className="panel">Đang tải dữ liệu…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="page-sub">
            Node STM32 · đầu dò đất RS485 (7 chỉ số) + 4 cảm biến siêu âm ·{' '}
            {latest?.created_at ? (
              <>dữ liệu <TimeAgo iso={latest.created_at} /></>
            ) : (
              'chưa có dữ liệu'
            )}
          </p>
        </div>
        <div className="topbar-status">
          <Pill ok={status?.masterOnline} title="ESP32 Master gửi dữ liệu lên backend">
            Master: {status?.masterOnline ? 'ONLINE' : 'OFFLINE'}
          </Pill>
          <Pill ok={status?.slaveOnline} title="Node cảm biến qua LoRa">
            Slave: {status?.slaveOnline ? 'ONLINE' : 'OFFLINE'}
          </Pill>
          <Pill
            ok={!sensor || sensor.level === 'ok'}
            title="Kết quả giao dịch Modbus cuối cùng của STM32"
          >
            RS485: {sensor ? sensor.text : '--'}
          </Pill>
          <Pill ok={connected}>{connected ? 'Realtime' : 'Mất kết nối'}</Pill>
        </div>
      </div>

      {error && <div className="form-msg error">⚠ Không tải được dữ liệu: {error}</div>}

      <MetricCards latest={latest} history={farm.history} thresholds={thresholds} />

      <TankLevels latest={latest} tanks={tanks} thresholds={thresholds} />

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
