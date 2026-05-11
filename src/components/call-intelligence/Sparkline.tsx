'use client';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}

const COLORS = {
  up: '#10b981',
  down: '#ef4444',
  flat: '#6b7280',
} as const;

export function Sparkline({ values, width = 100, height = 32, color }: SparklineProps) {
  if (values.length < 2) {
    return <span className="text-gray-400 text-sm" aria-label="No trend data">—</span>;
  }
  const padding = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((v - min) / range) * (height - 2 * padding);
    return `${x},${y}`;
  });

  const trend = values[values.length - 1] - values[0];
  const strokeColor = color ?? (trend > 0 ? COLORS.up : trend < 0 ? COLORS.down : COLORS.flat);

  return (
    <svg
      width={width}
      height={height}
      className="inline-block"
      role="img"
      aria-label={trend > 0 ? 'Trending up' : trend < 0 ? 'Trending down' : 'Flat trend'}
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
