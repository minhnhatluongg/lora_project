import { useFarm } from '../useFarm.js';
import { useAuth, can } from '../auth/AuthContext.jsx';
import { MetricCards } from '../components/MetricCards.jsx';
import { RealtimeCharts } from '../components/RealtimeCharts.jsx';
import { DeviceControl } from '../components/DeviceControl.jsx';
import { StatusPanel } from '../components/StatusPanel.jsx';
import { RecentTable } from '../components/RecentTable.jsx';
import { AlertsList } from '../components/AlertsList.jsx';

function Pill({ ok, children }) {
  return <span className={`pill ${ok ? 'pill-on' : 'pill-off'}`}>{children}</span>;
}

export function Dashboard() {
  const farm = useFarm();
  const { user } = useAuth();
  const { status, connected } = farm;
  const readOnly = !can.control(user.role);

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <div className="topbar-status">
          <Pill ok={status?.masterOnline}>
            LoRa: {status?.masterOnline ? 'ONLINE' : 'OFFLINE'}
          </Pill>
          <Pill ok={status?.slaveOnline}>
            Slave: {status?.slaveOnline ? 'ONLINE' : 'OFFLINE'}
          </Pill>
          <Pill ok={connected}>{connected ? 'Realtime' : 'Mất kết nối'}</Pill>
        </div>
      </div>

      <MetricCards latest={farm.latest} />

      <section className="grid-2">
        <RealtimeCharts history={farm.history} />
        <StatusPanel status={status} />
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
