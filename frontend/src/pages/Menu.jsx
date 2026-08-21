import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell.jsx';
import { useAuth, can } from '../auth/AuthContext.jsx';
import { socket } from '../socket.js';
import { useTaskBadge } from '../tasks/TaskBadgeContext.jsx';
import {
  IconDashboard,
  IconControl,
  IconGear,
  IconInfo,
  IconTasks,
  IconLock,
  IconLogout,
  IconChevronRight,
} from '../components/Icons.jsx';
import './Menu.css';

// The landing page of the HMI. Six large touch targets in a 2-column grid;
// the first four are navigation, the last two are the "account" pair and wear
// the red accent from the panel design.
//
// `gate` is optional. When present it is a capability predicate from
// AuthContext. A role that fails the gate still SEES the tile — see the note on
// `locked` in the component — it just cannot press it.
//
// `desc` is an ARRAY of authored lines, not a sentence left to wrap. The panel
// design breaks each card's copy at a different point ("… cảm biến và / trạng
// thái…" but "… nhóm thực hiện / và phiên bản…"), and no single measured column
// width reproduces all four: the width that keeps DASHBOARD's break is narrower
// than the one ABOUT's break needs. Authoring them also stops Vietnamese word
// pairs like "chế độ" and "thực hiện" being split across lines.
const ITEMS = [
  {
    id: 'dashboard',
    to: '/dashboard',
    title: 'DASHBOARD',
    desc: ['Xem dữ liệu cảm biến và', 'trạng thái hệ thống'],
    Icon: IconDashboard,
  },
  {
    id: 'control',
    to: '/control',
    title: 'CONTROL',
    desc: ['Điều khiển bơm, van và', 'chế độ hoạt động'],
    Icon: IconControl,
    gate: can.control,
  },
  {
    id: 'settings',
    to: '/settings',
    title: 'SETTINGS',
    desc: ['Cài đặt hệ thống, cảm biến,', 'mạng và tài khoản'],
    Icon: IconGear,
    gate: can.config,
  },
  {
    id: 'tasks',
    to: '/tasks',
    title: 'CÔNG VIỆC',
    desc: ['Việc được giao, tiến độ', 'và nhắc hạn'],
    Icon: IconTasks,
    // Ô duy nhất mang huy hiệu đếm. ABOUT trước ở chỗ này; trang đó vẫn còn,
    // giờ vào từ cuối trang SETTINGS.
    badge: true,
  },
  {
    id: 'change-password',
    to: '/change-password',
    title: 'CHANGE PASSWORD',
    desc: ['Đổi mật khẩu tài khoản'],
    Icon: IconLock,
    tone: 'danger',
  },
  {
    id: 'logout',
    action: 'logout',
    title: 'LOGOUT',
    desc: ['Đăng xuất khỏi hệ thống'],
    Icon: IconLogout,
    tone: 'danger',
  },
];

// Icon tile, then title / accent rule / description, then the affordance on the
// right. The accent rule is the design's divider between the title and the body
// copy; it inherits `--menu-accent` so it turns red on the account pair.
function CardInner({ Icon, title, desc, locked, badge }) {
  return (
    <>
      <span className="menu-card-icon">
        <Icon size={96} />
        {/* Huy hiệu mang CON SỐ chứ không phải chấm đỏ suông — cùng lý do với ổ
            khoá "Không đủ quyền" bên dưới: một mảng màu không nói được điều gì
            trên màn hình đơn sắc, và "có việc" khác hẳn "có bảy việc". */}
        {badge > 0 && (
          <span className="menu-card-badge" aria-hidden="true">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className="menu-card-text">
        <strong className="menu-card-title">
          {title}
          {badge > 0 && <span className="pageshell-sr"> — {badge} việc chưa xong</span>}
        </strong>
        <span className="menu-card-rule" aria-hidden="true" />
        <span className="menu-card-desc">
          {desc.map((line) => (
            <span className="menu-card-desc-line" key={line}>
              {line}
            </span>
          ))}
        </span>
      </span>
      {locked ? (
        // Not colour-alone: a lock glyph AND the words, so the restriction
        // survives a greyscale panel and a screen reader.
        <span className="menu-card-lockflag">
          <IconLock size={22} />
          <span>Không đủ quyền</span>
        </span>
      ) : (
        <span className="menu-card-chevron" aria-hidden="true">
          <IconChevronRight size={32} />
        </span>
      )}
    </>
  );
}

export function Menu() {
  const { user, logout } = useAuth();
  const { summary } = useTaskBadge();
  const role = user?.role;

  // MENU is the screen the panel idles on, so its link lamp is the one an
  // operator glances at from across the room. It must report the real socket,
  // never a constant. No data subscription — MENU draws none.
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    // The socket can finish its handshake between the render that seeded the
    // state above and this effect — React 18 commits asynchronously and the
    // handshake is a couple of milliseconds on a local link. Re-reading AFTER
    // subscribing closes that window; without it the lamp latches on the stale
    // seed and reports a dead link over a live one. (Measured: 2 of 4 cold
    // loads of /menu latched DOWN while the socket was demonstrably up.)
    setConnected(socket.connected);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return (
    <PageShell title="MENU" connected={connected}>
      <nav className="menu-grid" aria-label="Menu chính">
        {ITEMS.map((item) => {
          // The design is a fixed six-tile grid. Filtering the ungranted tiles
          // out would reflow the remaining ones into different cells for a
          // viewer, so the same panel would present two different layouts and
          // muscle memory would land on the wrong tile. Render all six and
          // disable instead. App.jsx still guards the routes.
          const locked = Boolean(item.gate && !item.gate(role));
          const badge = item.badge ? summary.open : 0;
          const className = [
            'menu-card',
            item.tone === 'danger' ? 'menu-card-danger' : '',
            locked ? 'menu-card-locked' : '',
          ]
            .filter(Boolean)
            .join(' ');

          if (locked) {
            return (
              <span key={item.id} className={className} aria-disabled="true">
                <CardInner Icon={item.Icon} title={item.title} desc={item.desc} locked />
              </span>
            );
          }

          // LOGOUT clears the session in place; everything else is a route.
          if (item.action === 'logout') {
            return (
              <button key={item.id} type="button" className={className} onClick={logout}>
                <CardInner Icon={item.Icon} title={item.title} desc={item.desc} />
              </button>
            );
          }

          return (
            <Link key={item.id} className={className} to={item.to}>
              <CardInner Icon={item.Icon} title={item.title} desc={item.desc} badge={badge} />
            </Link>
          );
        })}
      </nav>
    </PageShell>
  );
}

export default Menu;
