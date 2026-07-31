import { useEffect, useState } from 'react';
import { timeAgo, fmtDateTime } from '../metrics.js';

// "3 phút trước" has to keep counting on its own — nothing re-renders the
// dashboard when data STOPS arriving, which is exactly when this label matters.
// Self-contained so the tick doesn't re-render the charts around it.
export function TimeAgo({ iso, className }) {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 10000);
    return () => clearInterval(id);
  }, []);

  if (!iso) return <span className={className}>--</span>;
  return (
    <span className={className} title={fmtDateTime(iso)}>
      {timeAgo(iso)}
    </span>
  );
}
