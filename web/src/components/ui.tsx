import { AnimatePresence, animate, motion, useInView, type HTMLMotionProps } from 'motion/react';
import { Loader2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/format';

export const spring = { type: 'spring', stiffness: 380, damping: 30 } as const;

// ---------- Button ----------

type ButtonProps = HTMLMotionProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <motion.button
      whileHover={disabled || loading ? undefined : { y: -1 }}
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      transition={spring}
      disabled={disabled || loading}
      className={cx(
        'group relative inline-flex select-none items-center justify-center gap-2 overflow-hidden rounded-xl font-medium whitespace-nowrap transition-[background,box-shadow,color,opacity] duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'h-9 px-3 text-sm',
        size === 'md' && 'h-11 px-4 text-sm',
        size === 'lg' && 'h-13 px-6 text-base',
        variant === 'primary' &&
          'bg-gradient-to-r from-brand to-cyan/90 text-white shadow-[0_10px_30px_-10px_rgb(59_130_246/0.8)] hover:shadow-[0_14px_40px_-10px_rgb(59_130_246/0.95)]',
        variant === 'secondary' && 'border border-white/10 bg-white/[0.05] text-ink-100 hover:bg-white/[0.09]',
        variant === 'ghost' && 'text-ink-300 hover:bg-white/[0.06] hover:text-ink-100',
        variant === 'danger' && 'border border-bad/30 bg-bad/10 text-bad hover:bg-bad/20',
        className,
      )}
      {...rest}
    >
      {variant === 'primary' && (
        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
      )}
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children as ReactNode}
    </motion.button>
  );
}

// ---------- Card ----------

export function Card({ className, children, ...rest }: HTMLMotionProps<'div'>) {
  return (
    <motion.div className={cx('glass rounded-2xl', className)} {...rest}>
      {children}
    </motion.div>
  );
}

export function SectionTitle({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink-100">
        {icon && <span className="text-brand-soft">{icon}</span>}
        {children}
      </h2>
      {action}
    </div>
  );
}

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium', className)}
      style={
        color
          ? { color, borderColor: `${color}40`, background: `${color}14` }
          : { color: 'var(--color-ink-300)', borderColor: 'rgb(255 255 255 / 0.1)', background: 'rgb(255 255 255 / 0.04)' }
      }
    >
      {children}
    </span>
  );
}

// ---------- Segmented control with sliding pill ----------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  id,
  className,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  id: string;
  className?: string;
}) {
  return (
    <div className={cx('flex rounded-xl border border-white/8 bg-white/[0.03] p-1', className)} role="radiogroup">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'relative flex-1 rounded-lg px-2 py-2 text-sm font-medium transition-colors',
              active ? 'text-white' : 'text-ink-300 hover:text-ink-100',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={spring}
                className="absolute inset-0 rounded-lg bg-gradient-to-br from-brand/80 to-brand/40 shadow-[0_6px_20px_-8px_rgb(59_130_246/0.9)]"
              />
            )}
            <span className="relative">{o.label}</span>
            {o.hint && <span className="relative mt-0.5 block text-[11px] font-normal opacity-70">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Toggle ----------

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 text-left transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span>
        <span className="block text-sm font-medium text-ink-100">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-400">{description}</span>}
      </span>
      <span className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300', checked ? 'bg-gradient-to-r from-brand to-cyan' : 'bg-white/10')}>
        <motion.span
          layout
          transition={spring}
          className={cx('absolute top-1 size-5 rounded-full bg-white shadow-md', checked ? 'right-1' : 'left-1')}
        />
      </span>
    </button>
  );
}

// ---------- Slider ----------

export function Slider({ value, min, max, step = 1, onChange, ariaLabel }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; ariaLabel: string }) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <input
      type="range"
      aria-label={ariaLabel}
      className="range"
      style={{ ['--fill' as string]: fill }}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

// ---------- Chips ----------

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={cx(
        'rounded-full border px-3.5 py-1.5 text-sm transition-all duration-200',
        active
          ? 'border-brand-soft/60 bg-brand/20 text-white shadow-[0_0_20px_-6px_rgb(59_130_246/0.8)]'
          : 'border-white/10 bg-white/[0.03] text-ink-300 hover:border-white/20 hover:text-ink-100',
      )}
    >
      {children}
    </motion.button>
  );
}

// ---------- Animated number ----------

export function CountUp({ value, decimals = 0, duration = 1.2, className }: { value: number; decimals?: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const node = ref.current;
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => (node.textContent = v.toFixed(decimals)),
    });
    return () => controls.stop();
  }, [inView, value, decimals, duration]);
  return (
    <span ref={ref} className={className}>
      {(0).toFixed(decimals)}
    </span>
  );
}

// ---------- Modal ----------

export function Modal({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.97 }}
            transition={spring}
            className={cx('glass relative max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-3xl bg-ink-900/90 p-6', className ?? 'max-w-md')}
          >
            <button onClick={onClose} className="absolute top-4 right-4 rounded-lg p-1.5 text-ink-400 hover:bg-white/5 hover:text-ink-100" aria-label="Close">
              <X className="size-4" />
            </button>
            <h3 className="mb-2 pr-8 font-display text-xl font-semibold">{title}</h3>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------- Toasts ----------

type Toast = { id: number; message: string; tone: 'info' | 'error' | 'success' };
const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={spring}
              className={cx(
                'glass pointer-events-auto max-w-md rounded-xl bg-ink-900/90 px-4 py-3 text-sm shadow-2xl',
                t.tone === 'error' && 'border-bad/40 text-bad',
                t.tone === 'success' && 'border-good/40 text-good',
              )}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

// ---------- Misc ----------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('shimmer rounded-xl', className)} />;
}

export const stagger = {
  container: { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } } },
  item: {
    hidden: { opacity: 0, y: 16, filter: 'blur(4px)' },
    show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { type: 'spring', stiffness: 260, damping: 26 } },
  },
} as const;

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 text-ink-300">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
