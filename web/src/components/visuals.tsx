import { AnimatePresence, motion } from 'motion/react';
import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, type RefObject } from 'react';
import { cx } from '../lib/format';

export type OrbState = 'idle' | 'speaking' | 'listening' | 'thinking';

/** Animated background shared by every page. */
export function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-[20%] -left-[10%] h-[60vmax] w-[60vmax] animate-drift rounded-full bg-[radial-gradient(circle,rgb(59_130_246/0.22),transparent_60%)] blur-3xl" />
      <div className="absolute -top-[10%] -right-[20%] h-[55vmax] w-[55vmax] animate-drift-slow rounded-full bg-[radial-gradient(circle,rgb(34_211_238/0.14),transparent_60%)] blur-3xl" />
      <div className="absolute -bottom-[30%] left-[20%] h-[50vmax] w-[50vmax] animate-drift rounded-full bg-[radial-gradient(circle,rgb(29_78_216/0.16),transparent_60%)] blur-3xl [animation-delay:-8s]" />
      <div className="grid-bg absolute inset-0" />
      <div className="noise absolute inset-0 opacity-[0.035] mix-blend-overlay" />
    </div>
  );
}

/**
 * The interviewer's "face": a glowing orb that breathes when idle, pulses rings while
 * speaking, follows your voice level while listening and swirls while thinking.
 */
export function Orb({ state, size = 220, levelRef }: { state: OrbState; size?: number; levelRef?: RefObject<number> }) {
  const coreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state !== 'listening' || !levelRef) {
      if (coreRef.current) coreRef.current.style.transform = '';
      return;
    }
    let raf = 0;
    const tick = () => {
      const level = levelRef.current ?? 0;
      if (coreRef.current) coreRef.current.style.transform = `scale(${1 + level * 0.18})`;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [state, levelRef]);

  const palette = {
    idle: ['#3b82f6', '#22d3ee'],
    speaking: ['#60a5fa', '#22d3ee'],
    listening: ['#22d3ee', '#34d399'],
    thinking: ['#7dd3fc', '#3b82f6'],
  }[state];

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Glow */}
      <motion.div
        className="absolute inset-0 rounded-full blur-3xl"
        animate={{
          background: `radial-gradient(circle, ${palette[0]}66, ${palette[1]}22 55%, transparent 70%)`,
          scale: state === 'idle' ? [1, 1.08, 1] : state === 'speaking' ? [1, 1.15, 1] : 1.05,
        }}
        transition={{ duration: state === 'speaking' ? 1.2 : 4, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Speaking rings */}
      <AnimatePresence>
        {state === 'speaking' &&
          [0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="absolute rounded-full border"
              style={{ inset: size * 0.18, borderColor: `${palette[0]}80` }}
              initial={{ scale: 0.9, opacity: 0.7 }}
              animate={{ scale: 1.7, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: 'easeOut' }}
            />
          ))}
      </AnimatePresence>

      {/* Thinking satellites */}
      {state === 'thinking' && (
        <motion.div className="absolute" style={{ inset: size * 0.08 }} animate={{ rotate: 360 }} transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}>
          {[0, 120, 240].map((deg) => (
            <span
              key={deg}
              className="absolute top-1/2 left-1/2 size-2.5 rounded-full bg-accent shadow-[0_0_12px_#7dd3fc]"
              style={{ transform: `rotate(${deg}deg) translateY(-${size * 0.42}px)` }}
            />
          ))}
        </motion.div>
      )}

      {/* Core */}
      <div ref={coreRef} className="relative transition-transform duration-75" style={{ width: size * 0.62, height: size * 0.62 }}>
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{
            background: `conic-gradient(from 0deg, ${palette[0]}, ${palette[1]}, #7dd3fc, ${palette[0]})`,
            rotate: 360,
          }}
          transition={{ rotate: { duration: state === 'thinking' ? 3 : 12, repeat: Infinity, ease: 'linear' }, background: { duration: 0.6 } }}
          style={{ filter: 'blur(10px)' }}
        />
        <motion.div
          className="absolute inset-[6%] rounded-full"
          animate={{ scale: state === 'idle' ? [1, 1.03, 1] : 1 }}
          transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            background: `radial-gradient(circle at 35% 30%, rgb(255 255 255 / 0.55), transparent 28%),
              radial-gradient(circle at 70% 75%, ${palette[1]}aa, transparent 45%),
              radial-gradient(circle at 50% 50%, ${palette[0]}, #1e1b4b 78%)`,
            boxShadow: `inset 0 -10px 30px rgb(0 0 0 / 0.45), inset 0 8px 20px rgb(255 255 255 / 0.15), 0 0 60px ${palette[0]}55`,
          }}
        />
      </div>
    </div>
  );
}

/** Big record button whose halo follows the microphone level. */
export function MicButton({
  recording,
  disabled,
  onClick,
  levelRef,
  size = 84,
}: {
  recording: boolean;
  disabled?: boolean;
  onClick: () => void;
  levelRef: RefObject<number>;
  size?: number;
}) {
  const haloRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!recording) return;
    let raf = 0;
    const tick = () => {
      if (haloRef.current) haloRef.current.style.transform = `scale(${1 + (levelRef.current ?? 0) * 0.9})`;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [recording, levelRef]);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size * 1.8, height: size * 1.8 }}>
      {recording && (
        <>
          <span ref={haloRef} className="absolute rounded-full bg-bad/25 blur-md transition-transform duration-75" style={{ width: size, height: size }} />
          {[0, 1].map((i) => (
            <motion.span
              key={i}
              className="absolute rounded-full border-2 border-bad/40"
              style={{ width: size, height: size }}
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{ scale: 1.8, opacity: 0 }}
              transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.9 }}
            />
          ))}
        </>
      )}
      <motion.button
        type="button"
        onClick={onClick}
        disabled={disabled}
        whileHover={disabled ? undefined : { scale: 1.06 }}
        whileTap={disabled ? undefined : { scale: 0.92 }}
        aria-label={recording ? 'Stop recording' : 'Start recording'}
        className={cx(
          'relative z-10 flex items-center justify-center rounded-full text-white transition-[background,box-shadow] duration-300 disabled:cursor-not-allowed disabled:opacity-40',
          recording
            ? 'bg-gradient-to-br from-rose-500 to-rose-400 shadow-[0_10px_40px_-6px_rgb(251_113_133/0.8)]'
            : 'bg-gradient-to-br from-brand to-cyan shadow-[0_10px_40px_-6px_rgb(59_130_246/0.9)]',
        )}
        style={{ width: size, height: size }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={recording ? 'stop' : 'mic'} initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0, rotate: 90 }} transition={{ duration: 0.18 }}>
            {recording ? <Square className="size-7 fill-white" /> : <Mic className="size-8" />}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </div>
  );
}

/** Scrolling waveform drawn from the live mic level. */
export function LiveWave({ levelRef, active, className }: { levelRef: RefObject<number>; active: boolean; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const bars: number[] = [];
    let raf = 0;
    let frame = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gap = 4;
      const barW = 3;
      const count = Math.floor(w / (barW + gap));
      if (frame++ % 3 === 0) {
        bars.push(active ? Math.max(0.04, levelRef.current ?? 0) : 0.04);
        while (bars.length > count) bars.shift();
      }
      ctx.clearRect(0, 0, w, h);
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'rgba(59,130,246,0.15)');
      grad.addColorStop(0.6, 'rgba(96,165,250,0.9)');
      grad.addColorStop(1, 'rgba(34,211,238,1)');
      ctx.fillStyle = grad;
      bars.forEach((v, i) => {
        const bh = Math.max(3, v * h * 0.95);
        const x = w - (bars.length - i) * (barW + gap);
        ctx.beginPath();
        ctx.roundRect(x, (h - bh) / 2, barW, bh, 2);
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active, levelRef]);
  return <canvas ref={canvasRef} className={cx('h-12 w-full', className)} />;
}

/** Reveals text word by word, like the interviewer is saying it. */
export function Typewriter({ text, className }: { text: string; className?: string }) {
  const words = text.split(' ');
  return (
    <motion.p key={text} className={className} initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.035 } } }}>
      {words.map((w, i) => (
        <span key={i}>
          <motion.span
            className="inline-block"
            variants={{ hidden: { opacity: 0, y: 8, filter: 'blur(6px)' }, show: { opacity: 1, y: 0, filter: 'blur(0px)' } }}
            transition={{ duration: 0.35 }}
          >
            {w}
          </motion.span>{' '}
        </span>
      ))}
    </motion.p>
  );
}
