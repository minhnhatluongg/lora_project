import { useEffect, useState } from 'react';
import { IconHome, IconWifi, IconWifiOff, IconClock, IconCalendar } from './Icons.jsx';

// Header band of the control panel: branding, title, live clock and link state.
// The brand text is a placeholder — drop a logo file in and swap the <span> for
// an <img> if you have one.
export function PanelHeader({ connected }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="panel-header">
      <div className="ph-brand">
        <span className="ph-brand-main">FPT Education</span>
        <span className="ph-brand-sub">FPT POLYTECHNIC</span>
      </div>

      <div className="ph-center">
        <button className="ph-home" title="Trang chủ" aria-label="Trang chủ">
          <IconHome size={22} />
        </button>
        <h1 className="ph-title">
          <span className="ph-rule" aria-hidden="true" />
          DASHBOARD
          <span className="ph-rule" aria-hidden="true" />
        </h1>
      </div>

      <div className="ph-meta">
        <span
          className={`ph-link ${connected ? 'ph-link-on' : 'ph-link-off'}`}
          title={connected ? 'Đang kết nối máy chủ' : 'Mất kết nối máy chủ'}
        >
          {connected ? <IconWifi size={22} /> : <IconWifiOff size={22} />}
        </span>
        <div className="ph-datetime">
          <span>
            <IconClock size={14} />
            {now.toLocaleTimeString('vi-VN', { hour12: false })}
          </span>
          <span>
            <IconCalendar size={14} />
            {now.toLocaleDateString('vi-VN')}
          </span>
        </div>
      </div>
    </header>
  );
}
