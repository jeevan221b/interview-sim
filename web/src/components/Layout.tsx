import { motion } from 'motion/react';
import { History, LayoutDashboard, Plus, Settings, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { cx } from '../lib/format';
import { spring } from './ui';
import { Aurora } from './visuals';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/setup', label: 'Practice', icon: Sparkles },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
];

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

  return (
    <div className="relative min-h-dvh">
      <Aurora />
      {!focusMode && (
        <header className="sticky top-0 z-40 border-b border-white/5 bg-ink-950/60 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
            <Logo />
            <nav className="hidden items-center gap-1 rounded-2xl border border-white/5 bg-white/[0.02] p-1 md:flex">
              {NAV.map(({ to, label, icon: Icon }) => {
                const active = isActive(to, pathname);
                return (
                  <NavLink key={to} to={to} className={cx('relative flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors', active ? 'text-white' : 'text-ink-300 hover:text-ink-100')}>
                    {active && <motion.span layoutId="nav-pill" transition={spring} className="absolute inset-0 rounded-xl bg-white/[0.08] ring-1 ring-white/10" />}
                    <Icon className="relative size-4" />
                    <span className="relative">{label}</span>
                  </NavLink>
                );
              })}
            </nav>
            <Link
              to="/setup"
              className="hidden items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand to-cyan/90 px-4 py-2 text-sm font-medium text-white shadow-[0_8px_24px_-10px_rgb(59_130_246/0.9)] transition-transform hover:-translate-y-0.5 md:flex"
            >
              <Plus className="size-4" /> New interview
            </Link>
          </div>
        </header>
      )}

      <main className={cx('mx-auto max-w-6xl px-4 sm:px-6', focusMode ? 'py-4' : 'pt-6 pb-28 md:pb-16')}>{children}</main>

      {!focusMode && (
        <nav className="fixed inset-x-3 bottom-3 z-40 rounded-2xl border border-white/10 bg-ink-900/80 p-1.5 shadow-2xl backdrop-blur-xl md:hidden" style={{ marginBottom: 'var(--safe-bottom)' }}>
          <div className="grid grid-cols-4">
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
