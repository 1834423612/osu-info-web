import { occupancyLevel } from "@/lib/utils";

export function OccupancyRing({
  percentage,
  size = 48,
}: {
  percentage: number;
  size?: number;
}) {
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(percentage, 0), 100);
  const level = occupancyLevel(progress);

  return (
    <span
      className={`occupancy-ring level-${level}`}
      style={{ width: size, height: size }}
      aria-label={`占用率 ${progress}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="occupancy-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="occupancy-ring__value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress / 100)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <b>{progress}%</b>
    </span>
  );
}
