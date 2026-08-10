import { useEffect, useState } from 'react';
import { PageShell } from '../components/PageShell.jsx';
import { socket } from '../socket.js';
import './About.css';

// Project credits. The names and student IDs below are transcribed from the
// panel design (front_require/5.jpg) character for character, diacritics
// included — treat them as data, not copy, and do not "tidy" them.
const MEMBERS = [
  { name: 'Cống Hiến Khoa', id: 'PS46674' },
  { name: 'Trịnh Hoàng Minh Đức', id: 'PS44963' },
  { name: 'Nguyễn Quốc Hà', id: 'PS46638' },
  { name: 'Nguyễn Minh Khoa', id: 'PS45506' },
  { name: 'Bùi Phan Minh Phát', id: 'PS46454' },
  { name: 'Vũ Mạnh Tiến', id: 'PS46353' },
  { name: 'Đào Văn Trường', id: 'PS46011' },
];

export function About() {
  // ABOUT draws no live data, but the shell's link lamp is on this page too and
  // a lamp that is green because nobody wired it is a false status signal. The
  // socket is an app-wide singleton, so subscribing costs one listener.
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    // Re-read after subscribing: the handshake can land between the seeding
    // render and this effect, and a missed 'connect' latches the lamp DOWN.
    setConnected(socket.connected);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return (
    <PageShell title="ABOUT" onBack="/menu" connected={connected}>
      <div className="about-wrap">
        <blockquote className="about-quote">
          <span className="about-quote-line">
            “Ứng dụng công nghệ LoRaWAN trong thiết kế
          </span>
          <span className="about-quote-line">
            hệ thống tưới chính xác và quản lý dinh dưỡng cho cây ăn quả”
          </span>
        </blockquote>

        <p className="about-advisor">GVHD: Thầy Phạm Hữu Phúc</p>

        {/* `role="list"` is not redundant: WebKit strips list semantics from any
            list whose `list-style` is none, and this one has to be none because
            the visible numbering is a counter inside the name column. */}
        <ol className="about-members" role="list">
          {MEMBERS.map((member) => (
            <li className="about-member" key={member.id}>
              <span className="about-member-name">{member.name}</span>
              <span className="about-member-id">{member.id}</span>
            </li>
          ))}
        </ol>
      </div>
    </PageShell>
  );
}

export default About;
