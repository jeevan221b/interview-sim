import { motion } from 'motion/react';
import { useId, useState } from 'react';
import { DIMENSION_LABELS, scoreTone } from '../lib/format';
import { CountUp } from './ui';

/** Big animated score ring (0–100). */
export function ScoreRing({ score, size = 180, stroke = 12, label = true }: { score: number; size?: number; stroke?: number; label?: boolean }) {
  const id = useId();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute inset-[15%] rounded-full blur-2xl" style={{ background: tone.color, opacity: 0.25 }} />
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={tone.color} />
            <stop offset="100%" stopColor="#60a5fa" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(100, score)) / 100) }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display leading-none font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.27) }}>
          <CountUp value={score} duration={1.4} />
        </span>
        {label && (
          <span className="mt-1 text-xs font-medium tracking-wide uppercase" style={{ color: tone.color }}>
            {tone.label}
          </span>
        )}
      </div>
    </div>
  );
}

/** Small static ring for lists. */
export function MiniRing({ score, size = 44 }: { score: number | null; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score ?? 0);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={stroke} />
        {score !== null && (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={tone.color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: c * (1 - score / 100) }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">{score ?? '–'}</span>
    </div>
  );
}

/** Countdown ring used for think time and answer time. */
export function TimerRing({ progress, size = 56, color = '#60a5fa', children }: { progress: number; size?: number; color?: string; children?: React.ReactNode }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, progress)))}
          style={{ transition: 'stroke-dashoffset 0.25s linear, stroke 0.3s' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">{children}</div>
    </div>
  );
}

/** Radar chart for the six scoring dimensions (0–10). */
export function RadarChart({ values, size = 300 }: { values: Record<string, number>; size?: number }) {
  const id = useId();
  const keys = Object.keys(values);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 44;
  const point = (i: number, v: number) => {
    const angle = (Math.PI * 2 * i) / keys.length - Math.PI / 2;
    return [cx + Math.cos(angle) * radius * (v / 10), cy + Math.sin(angle) * radius * (v / 10)];
  };
  const polygon = keys.map((k, i) => point(i, values[k]).join(',')).join(' ');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[340px]" role="img" aria-label="Score by dimension">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {[2, 4, 6, 8, 10].map((level) => (
        <polygon
          key={level}
          points={keys.map((_, i) => point(i, level).join(',')).join(' ')}
          fill="none"
          stroke="rgb(255 255 255 / 0.07)"
          strokeWidth={1}
        />
      ))}
      {keys.map((_, i) => {
        const [x, y] = point(i, 10);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgb(255 255 255 / 0.06)" />;
      })}
      <motion.polygon
        points={polygon}
        fill={`url(#${id})`}
        stroke="#60a5fa"
        strokeWidth={2}
        strokeLinejoin="round"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 120, damping: 16, delay: 0.3 }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      {keys.map((k, i) => {
        const [x, y] = point(i, values[k]);
        return (
          <motion.circle
            key={k}
            cx={x}
            cy={y}
            r={4}
            fill="#08101f"
            stroke="#93c5fd"
            strokeWidth={2}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 + i * 0.05 }}
          />
        );
      })}
      {keys.map((k, i) => {
        const [x, y] = point(i, 12.6);
        return (
          <text key={k} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-ink-300 text-[11px] font-medium">
            <tspan x={x} dy="-0.5em">
              {DIMENSION_LABELS[k] || k}
            </tspan>
            <tspan x={x} dy="1.3em" className="fill-ink-100 font-semibold">
              {values[k].toFixed(1)}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}

/** Area chart of overall scores over time, with hover read-out. */
export function TrendChart({ points, height = 160, onSelect }: { points: { date: string; score: number; topic: string; id: string }[]; height?: number; onSelect?: (id: string) => void }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const width = 600;
  const pad = { t: 16, b: 24, l: 8, r: 8 };
  if (points.length === 0) return null;
  const xs = (i: number) => pad.l + (points.length === 1 ? (width - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (width - pad.l - pad.r));
  const ys = (v: number) => pad.t + (1 - v / 100) * (height - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${xs(i)},${ys(p.score)}`).join(' ');
  const area = `${line} L${xs(points.length - 1)},${height - pad.b} L${xs(0)},${height - pad.b} Z`;
  const active = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full overflow-visible"
        preserveAspectRatio="none"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * width;
          let best = 0;
          points.forEach((_, i) => Math.abs(xs(i) - x) < Math.abs(xs(best) - x) && (best = i));
          setHover(best);
        }}
        onClick={() => hover !== null && onSelect?.(points[hover].id)}
      >
        <defs>
          <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-l`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        {[25, 50, 75].map((v) => (
          <line key={v} x1={0} x2={width} y1={ys(v)} y2={ys(v)} stroke="rgb(255 255 255 / 0.05)" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
        ))}
        <motion.path d={area} fill={`url(#${id}-a)`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.3 }} />
        <motion.path
          d={line}
          fill="none"
          stroke={`url(#${id}-l)`}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: 'easeInOut' }}
        />
        {hover !== null && (
          <line x1={xs(hover)} x2={xs(hover)} y1={pad.t} y2={height - pad.b} stroke="rgb(255 255 255 / 0.2)" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* Dots are HTML so they stay round when the SVG stretches. */}
      {points.map((p, i) => (
        <span
          key={p.id}
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-900 transition-transform"
          style={{
            left: `${(xs(i) / width) * 100}%`,
            top: ys(p.score),
            background: scoreTone(p.score).color,
            transform: `translate(-50%, -50%) scale(${hover === i ? 1.6 : 1})`,
          }}
        />
      ))}
      {active && hover !== null && (
        <div
          className="glass pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-ink-900/90 px-3 py-2 text-xs whitespace-nowrap"
          style={{ left: `${Math.min(88, Math.max(12, (xs(hover) / width) * 100))}%`, top: ys(active.score) - 10 }}
        >
          <div className="font-semibold" style={{ color: scoreTone(active.score).color }}>
            {active.score} / 100
          </div>
          <div className="text-ink-300">{active.topic}</div>
          <div className="text-ink-400">{new Date(active.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>
        </div>
      )}
    </div>
  );
}

/** Horizontal score bar (0–10). */
export function ScoreBar({ label, value, delay = 0 }: { label: string; value: number; delay?: number }) {
  const tone = scoreTone(value * 10);
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-ink-300">{label}</span>
        <span className="font-semibold tabular-nums" style={{ color: tone.color }}>
          {value.toFixed(1)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${tone.color}aa, ${tone.color})` }}
          initial={{ width: 0 }}
          animate={{ width: `${value * 10}%` }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay }}
        />
      </div>
    </div>
  );
}
