// Tiny trend line for a stat tile: no axes, no labels — the shape is the point.
// Hand-rolled SVG so a KPI row of these stays cheap to render.
export function Sparkline({ values, color, width = 96, height = 28 }) {
  const points = (values || []).filter((v) => v != null && Number.isFinite(v));
  if (points.length < 2) return <svg width={width} height={height} aria-hidden="true" />;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const y = (v) => height - 2 - ((v - min) / span) * (height - 4);

  const line = points.map((v, i) => `${i * stepX},${y(v)}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  const gradientId = `spark-${color.replace('#', '')}`;

  return (
    <svg width={width} height={height} aria-hidden="true" className="sparkline">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={width} cy={y(points[points.length - 1])} r="2.5" fill={color} />
    </svg>
  );
}
