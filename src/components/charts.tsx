// Custom SVG charts (lighter than a chart lib, fits the neon/mono aesthetic).
// Ported from docs/design/prototype/admin.jsx.
import { useId } from "react";

type Series<K extends string> = { key: K; color: string };
type Row<X extends string, K extends string> = Record<X, string> & Record<K, number>;

const W = 600;
const pad = { t: 12, r: 12, b: 24, l: 32 };
const axisText = { fill: "var(--color-muted)" };
const gridLine = { stroke: "var(--color-border)" };

const useScale = <K extends string>(
  data: Record<K, number>[],
  series: Series<K>[],
  height: number,
) => {
  const w = W - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const maxY = Math.max(...series.flatMap((s) => data.map((d) => d[s.key])), 1);
  const scaleY = (v: number) => pad.t + h - (h * v) / maxY;
  const yVals = Array.from({ length: 5 }, (_, i) => (maxY * i) / 4);
  const xStep = Math.ceil(data.length / 6);
  return { w, h, scaleY, yVals, xStep };
};

const YGrid = ({
  yVals,
  scaleY,
  w,
}: {
  yVals: number[];
  scaleY: (v: number) => number;
  w: number;
}) => (
  <>
    {yVals.map((v) => (
      <g key={v}>
        <line
          x1={pad.l}
          x2={pad.l + w}
          y1={scaleY(v)}
          y2={scaleY(v)}
          style={gridLine}
          strokeDasharray="2 3"
        />
        <text
          x={pad.l - 6}
          y={scaleY(v)}
          dy="3"
          textAnchor="end"
          style={axisText}
          fontSize="9"
          fontFamily="inherit"
          letterSpacing="0.05em"
        >
          {Math.round(v)}
        </text>
      </g>
    ))}
  </>
);

export const LineChart = <X extends string, K extends string>({
  data,
  xKey,
  series,
  height = 160,
  label,
}: {
  data: Row<X, K>[];
  xKey: X;
  series: Series<K>[];
  height?: number;
  label: string;
}) => {
  const uid = useId();
  const { w, h, scaleY, yVals, xStep } = useScale(data, series, height);
  const scaleX = (i: number) => pad.l + (w * i) / Math.max(1, data.length - 1);
  const path = (key: K) =>
    data
      .map((d, i) => `${i === 0 ? "M" : "L"} ${scaleX(i).toFixed(1)} ${scaleY(d[key]).toFixed(1)}`)
      .join(" ");
  const area = (key: K) =>
    `${path(key)} L ${scaleX(data.length - 1)} ${pad.t + h} L ${pad.l} ${pad.t + h} Z`;

  return (
    <svg
      className="w-full h-auto block"
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <defs>
        {series.map((s) => (
          <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      <YGrid yVals={yVals} scaleY={scaleY} w={w} />
      {data.map(
        (d, i) =>
          (i % xStep === 0 || i === data.length - 1) && (
            <text
              key={d[xKey]}
              x={scaleX(i)}
              y={pad.t + h + 14}
              textAnchor="middle"
              style={axisText}
              fontSize="9"
              fontFamily="inherit"
              letterSpacing="0.05em"
            >
              {d[xKey]}
            </text>
          ),
      )}
      {series.map((s) => (
        <g key={s.key}>
          <path d={area(s.key)} fill={`url(#${uid}-${s.key})`} />
          <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth="1.5" />
          {data.map((d, i) => (
            <circle key={d[xKey]} cx={scaleX(i)} cy={scaleY(d[s.key])} r="2" fill={s.color}>
              <title>{`${d[xKey]} · ${d[s.key]}`}</title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
  );
};

export const BarChart = <X extends string, K extends string>({
  data,
  xKey,
  series,
  height = 160,
  label,
}: {
  data: Row<X, K>[];
  xKey: X;
  series: Series<K>[];
  height?: number;
  label: string;
}) => {
  const { w, h, scaleY, yVals, xStep } = useScale(data, series, height);
  const group = w / data.length;
  const barW = (group - 4) / series.length;

  return (
    <svg
      className="w-full h-auto block"
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <YGrid yVals={yVals} scaleY={scaleY} w={w} />
      {data.map((d, i) => (
        <g key={d[xKey]}>
          {series.map((s, si) => {
            const y = scaleY(d[s.key]);
            return (
              <rect
                key={s.key}
                x={pad.l + i * group + 2 + si * barW}
                y={y}
                width={barW - 1}
                height={Math.max(1, pad.t + h - y)}
                fill={s.color}
                rx="1"
              >
                <title>{`${d[xKey]} · ${s.key} ${d[s.key]}`}</title>
              </rect>
            );
          })}
          {(i % xStep === 0 || i === data.length - 1) && (
            <text
              x={pad.l + i * group + group / 2}
              y={pad.t + h + 14}
              textAnchor="middle"
              style={axisText}
              fontSize="9"
              fontFamily="inherit"
            >
              {d[xKey]}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
};
