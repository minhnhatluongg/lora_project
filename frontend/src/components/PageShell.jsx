import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  IconHome,
  IconWifi,
  IconWifiOff,
  IconWifiUnknown,
  IconClock,
  IconCalendar,
  IconArrowLeft,
} from './Icons.jsx';

// Shared chrome for every HMI page: brand block, home button, link state and
// live clock, then the big royal-blue page title flanked by circuit flourishes.
// Pages render their own content as children and never redraw this band.

const pad = (n) => String(n).padStart(2, '0');
const clockText = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dateText = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

// Stylised PCB trace either side of the title: a thin blue polyline that steps
// up, runs past a row of solder dots and steps back down, pinned by via rings.
// The right-hand copy is the same drawing mirrored in CSS.
function CircuitTrace({ flip = false }) {
  return (
    <svg
      className={`pageshell-trace${flip ? ' pageshell-trace-flip' : ''}`}
      viewBox="0 0 220 44"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 31h48" />
        <path d="M68 31h22l12-14h14" />
        <path d="M150 17h14l12 14h36" />
        <circle cx="62" cy="31" r="4.6" />
        <circle cx="144" cy="17" r="4.6" />
      </g>
      <g fill="currentColor">
        <circle cx="4" cy="31" r="3.2" />
        <circle cx="216" cy="31" r="3.2" />
        <circle cx="116" cy="17" r="3.4" />
        <circle cx="127" cy="17" r="3.4" />
        <circle cx="138" cy="17" r="3.4" />
      </g>
    </svg>
  );
}

// The FPT mark: white letters on the blue / orange / green tiles of the real
// logotype, then "Education" in blue. The tile colours are the darkened family
// used everywhere else in this stylesheet so white-on-tile still clears AA.
function BrandMark() {
  return (
    <span className="pageshell-brand-main">
      <span className="pageshell-fpt" aria-hidden="true">
        <b className="pageshell-fpt-f">F</b>
        <b className="pageshell-fpt-p">P</b>
        <b className="pageshell-fpt-t">T</b>
      </span>
      <span className="pageshell-brand-edu">Education</span>
      <span className="pageshell-sr">FPT Education</span>
    </span>
  );
}

// Three link states, not two. `connected === undefined/null` means the page
// never told us, which is not the same claim as "the server is up" — it draws a
// grey, dashed glyph so an unwired page cannot show a false green lamp.
const LINK_STATE = {
  on: { Icon: IconWifi, cls: 'pageshell-wifi-on', label: 'Đang kết nối máy chủ' },
  off: { Icon: IconWifiOff, cls: 'pageshell-wifi-off', label: 'Mất kết nối máy chủ' },
  unknown: {
    Icon: IconWifiUnknown,
    cls: 'pageshell-wifi-unknown',
    label: 'Không rõ trạng thái kết nối máy chủ',
  },
};

export function PageShell({ title, onBack, children, actions, connected = null }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // `onBack` is normally a route path ("/menu"); a function is accepted too so a
  // page can intercept the press (unsaved-changes guards, wizards).
  let back = null;
  if (typeof onBack === 'function') {
    back = (
      <button type="button" className="pageshell-back" onClick={onBack}>
        <IconArrowLeft size={20} />
        QUAY LẠI
      </button>
    );
  } else if (onBack) {
    back = (
      <Link className="pageshell-back" to={onBack}>
        <IconArrowLeft size={20} />
        QUAY LẠI
      </Link>
    );
  }

  const hasFooter = Boolean(back || actions);
  const footerRef = useRef(null);
  const sentinelRef = useRef(null);
  const [floating, setFloating] = useState(false);

  // The footer is `position: sticky`, so it is pinned to the bottom of the
  // viewport whenever the page is taller than the screen and drops back into
  // normal flow the moment it isn't. The only thing that has to be decided at
  // runtime is whether to paint its background and hairline: a 1px sentinel
  // parked at the footer's resting place is off screen exactly while the bar is
  // holding itself up, so its visibility is the "am I floating" test.
  useEffect(() => {
    const root = document.documentElement;
    const footer = footerRef.current;
    const sentinel = sentinelRef.current;
    if (!hasFooter || !footer || !sentinel) {
      setFloating(false);
      root.style.removeProperty('--pageshell-footer-h');
      return undefined;
    }

    const measure = () => {
      const h = Math.round(footer.getBoundingClientRect().height);
      root.style.setProperty('--pageshell-footer-h', `${h}px`);
    };
    measure();

    const ro =
      typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(footer);

    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(([entry]) => setFloating(!entry.isIntersecting))
        : null;
    io?.observe(sentinel);

    return () => {
      ro?.disconnect();
      io?.disconnect();
      root.style.removeProperty('--pageshell-footer-h');
    };
  }, [hasFooter]);

  const link = LINK_STATE[connected == null ? 'unknown' : connected ? 'on' : 'off'];
  const LinkIcon = link.Icon;

  return (
    <div className="pageshell">
      <header className="pageshell-chrome">
        <div className="pageshell-brandwrap">
          <div className="pageshell-brand">
            <BrandMark />
            <span className="pageshell-brand-sub">FPT POLYTECHNIC</span>
          </div>
          <span className="pageshell-sep" aria-hidden="true" />
        </div>

        <Link className="pageshell-home" to="/menu" title="Trang chủ" aria-label="Trang chủ">
          <IconHome size={30} />
        </Link>

        <div className="pageshell-meta">
          <span
            className={`pageshell-wifi ${link.cls}`}
            title={link.label}
            role="img"
            aria-label={link.label}
          >
            <LinkIcon size={30} />
          </span>
          <span className="pageshell-sep" aria-hidden="true" />
          <div className="pageshell-datetime">
            <span className="pageshell-dt">
              <IconClock size={20} />
              {clockText(now)}
            </span>
            <span className="pageshell-dt">
              <IconCalendar size={20} />
              {dateText(now)}
            </span>
          </div>
        </div>
      </header>

      <div className="pageshell-titlebar">
        <CircuitTrace />
        <h1 className="pageshell-title">{title}</h1>
        <CircuitTrace flip />
      </div>

      <div className="pageshell-body">{children}</div>

      {hasFooter && (
        <>
          <div
            ref={footerRef}
            className={`pageshell-footer${floating ? ' pageshell-footer-floating' : ''}${
              actions ? ' pageshell-footer-split' : ''
            }`}
          >
            <div className="pageshell-footer-left">{back}</div>
            {actions ? <div className="pageshell-actions">{actions}</div> : null}
          </div>
          <span ref={sentinelRef} className="pageshell-footer-sentinel" aria-hidden="true" />
        </>
      )}
    </div>
  );
}
