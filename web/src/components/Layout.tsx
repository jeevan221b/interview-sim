import { AnimatePresence, motion } from 'motion/react';
import { Eye, History, LayoutDashboard, LogOut, Plus, Settings, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { getDevUser, setDevUser, setToken } from '../lib/api';
import { cx } from '../lib/format';
import { refreshMe, useMe } from '../lib/hooks';
import type { Me } from '../lib/types';
import { Badge, spring } from './ui';
import { Aurora } from './visuals';

const BASE_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/setup', label: 'Practice', icon: Sparkles },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
];
const ADMIN_NAV = { to: '/admin', label: 'Admin', icon: ShieldCheck };

export const initials = (email: string, name?: string) =>
  (name || email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export function Avatar({ email, name, size = 'md' }: { email: string; name?: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cx(
        'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-cyan font-semibold text-white ring-2 ring-white/10',
        size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm',
      )}
    >
      {initials(email, name)}
    </span>
  );
}

function signOut(me: Me) {
  if (me.logoutUrl) location.href = me.logoutUrl;
  else if (me.via === 'token') {
    setToken('');
    location.reload();
  }
}

function UserMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const { used, limit } = me.usage;
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <div ref={ref} className="relative">
      <motion.button whileTap={{ scale: 0.94 }} onClick={() => setOpen((v) => !v)} aria-label="Account" aria-expanded={open} className="rounded-full">
        <Avatar email={me.email} name={me.name} size="sm" />
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            className="glass absolute top-12 right-0 z-50 w-72 origin-top-right rounded-2xl bg-ink-900/95 p-4"
          >
            <div className="flex items-center gap-3">
              <Avatar email={me.email} name={me.name} />
              <div className="min-w-0">
                {me.name && <div className="truncate font-medium">{me.name}</div>}
                <div className="truncate text-sm text-ink-300">{me.email}</div>
              </div>
            </div>
            <div className="mt-3">{me.isAdmin ? <Badge color="#34d399">Admin</Badge> : <Badge>Member</Badge>}</div>
            <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.02] p-3">
              <div className="flex justify-between text-xs text-ink-400">
                <span>AI requests today</span>
                <span className="text-ink-200 tabular-nums">
                  {used}
                  {limit !== null ? ` / ${limit}` : ''}
                </span>
              </div>
              {limit !== null ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-gradient-to-r from-brand to-cyan" style={{ width: `${pct}%` }} />
                </div>
              ) : (
                <p className="mt-1 text-xs text-ink-400">No daily limit</p>
              )}
            </div>
            {(me.logoutUrl || me.via === 'token') && (
              <button onClick={() => signOut(me)} className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100">
                <LogOut className="size-4" /> Sign out
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** While the app is open and visible, check in once a minute: keeps "online now" accurate for the admin and usage fresh. */
function useHeartbeat() {
  useEffect(() => {
    const beat = () => document.visibilityState === 'visible' && refreshMe();
    const id = window.setInterval(beat, 60_000);
    document.addEventListener('visibilitychange', beat);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', beat);
    };
  }, []);
}

function DevBanner() {
  const devUser = getDevUser();
  if (!devUser) return null;
  return (
    <div className="relative z-50 flex items-center justify-center gap-3 bg-warn/15 px-4 py-2 text-xs text-warn">
      <Eye className="size-4 shrink-0" />
      <span className="truncate">
        Dev mode: viewing as <b>{devUser}</b>
      </span>
      <button
        className="shrink-0 rounded-lg bg-warn/20 px-2 py-1 font-medium hover:bg-warn/30"
        onClick={() => {
          setDevUser('');
          location.reload();
        }}
      >
        Back to me
      </button>
    </div>
  );
}

export function Logo() {
  return (
    <Link to="/" className="group flex items-center gap-2.5">
      <span className="relative flex size-9 items-center justify-center rounded-xl bg-ink-800 ring-1 ring-white/10 transition-transform group-hover:rotate-6">
        <span className="size-4 rounded-full bg-gradient-to-br from-brand-soft to-cyan shadow-[0_0_16px_rgb(59_130_246/0.9)]" />
      </span>
      <span className="font-display text-lg font-semibold tracking-tight">
        Interview<span className="gradient-text">Sim</span>
      </span>
    </Link>
  );
}

const isActive = (to: string, path: string) => (to === '/' ? path === '/' : path.startsWith(to));

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const focusMode = pathname.startsWith('/interview/');
  const me = useMe().data;
  useHeartbeat();
  const NAV = me?.isAdmin ? [...BASE_NAV, ADMIN_NAV] : BASE_NAV;

  return (
    <div className="relative min-h-dvh">
      <Aurora />
      <DevBanner />
      {!focusMode && (
        <header className="sticky top-0 z-40 border-b border-white/5 bg-ink-950/60 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
            <Logo />
            <nav className="hidden items-center gap-1 rounded-2xl border border-white/5 bg-white/[0.02] p-1 md:flex">
              {NAV.map(({ to, label, icon: Icon }) => {
                const active = isActive(to, pathname);
                return (
                  <NavLink key={to} to={to} className={cx('relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors lg:px-4', active ? 'text-white' : 'text-ink-300 hover:text-ink-100')}>
                    {active && <motion.span layoutId="nav-pill" transition={spring} className="absolute inset-0 rounded-xl bg-white/[0.08] ring-1 ring-white/10" />}
                    <Icon className="relative size-4" />
                    <span className="relative">{label}</span>
                  </NavLink>
                );
              })}
            </nav>
            <div className="flex items-center gap-3">
              <Link
                to="/setup"
                className="hidden items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand to-cyan/90 px-4 py-2 text-sm font-medium text-white shadow-[0_8px_24px_-10px_rgb(59_130_246/0.9)] transition-transform hover:-translate-y-0.5 lg:flex"
              >
                <Plus className="size-4" /> New interview
              </Link>
              {me && <UserMenu me={me} />}
            </div>
          </div>
        </header>
      )}

      <main className={cx('mx-auto max-w-6xl px-4 sm:px-6', focusMode ? 'py-4' : 'pt-6 pb-28 md:pb-16')}>{children}</main>

      {!focusMode && (
        <nav className="fixed inset-x-3 bottom-3 z-40 rounded-2xl border border-white/10 bg-ink-900/80 p-1.5 shadow-2xl backdrop-blur-xl md:hidden" style={{ marginBottom: 'var(--safe-bottom)' }}>
          <div className={cx('grid', NAV.length === 5 ? 'grid-cols-5' : 'grid-cols-4')}>
            {NAV.map(({ to, label, icon: Icon }) => {
              const active = isActive(to, pathname);
              return (
                <NavLink key={to} to={to} className={cx('relative flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors', active ? 'text-white' : 'text-ink-400')}>
                  {active && <motion.span layoutId="tab-pill" transition={spring} className="absolute inset-0 rounded-xl bg-gradient-to-b from-brand/30 to-brand/10 ring-1 ring-brand-soft/30" />}
                  <Icon className="relative size-5" />
                  <span className="relative">{label}</span>
                </NavLink>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
