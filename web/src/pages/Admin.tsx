import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  Bot,
  ChevronRight,
  Clock,
  Eye,
  Gauge,
  Globe,
  History,
  LogIn,
  MessageSquareText,
  Monitor,
  Pause,
  Play,
  Search,
  ShieldX,
  Smartphone,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Avatar } from '../components/Layout';
import { QuotaPanel } from '../components/quota';
import { Badge, Button, Card, Chip, CountUp, Modal, PageHeader, SectionTitle, Skeleton, Toggle, stagger, useToast } from '../components/ui';
import { api, setDevUser } from '../lib/api';
import { compact, cx, describeDevice, formatDateTime, isMobileUa, relativeDate, scoreTone, spanLabel } from '../lib/format';
import { useAsync, useMe } from '../lib/hooks';
import type { ActivityEvent, AdminUser, AdminUserDetail } from '../lib/types';

const REFRESH_MS = 30_000;
type Filter = 'all' | 'online' | 'never' | 'paused';

/** Re-runs `fn` every `ms` while the tab is visible (online status changes by itself). */
function usePolling(fn: () => void, ms: number) {
  useEffect(() => {
    const id = window.setInterval(() => document.visibilityState === 'visible' && fn(), ms);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms]);
}

function presence(u: AdminUser) {
  if (u.status === 'disabled') return { label: 'Paused', color: '#fbbf24', dot: 'bg-warn' };
  if (u.online) return { label: 'Online now', color: '#34d399', dot: 'bg-good' };
  if (!u.lastSeenAt) return { label: 'Never signed in', color: '#6a7b9c', dot: 'bg-ink-600' };
  if (u.signedOutAt && u.signedOutAt >= u.lastSeenAt) return { label: `Signed out ${relativeDate(u.signedOutAt)}`, color: '#9badc9', dot: 'bg-ink-400' };
  return { label: `Last seen ${relativeDate(u.lastSeenAt)}`, color: '#9badc9', dot: 'bg-ink-400' };
}

function StatusAvatar({ u, size = 'md' }: { u: AdminUser; size?: 'sm' | 'md' }) {
  const p = presence(u);
  return (
    <span className="relative">
      <span className={cx(u.status === 'disabled' && 'opacity-50 grayscale')}>
        <Avatar email={u.email} name={u.name} size={size} />
      </span>
      <span className={cx('absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-2 ring-ink-900', p.dot)}>
        {u.online && <span className="absolute inset-0 animate-ping rounded-full bg-good/70" />}
      </span>
    </span>
  );
}

export function AdminPage() {
  const me = useMe().data;
  const data = useAsync(() => api.admin.users(), []);
  const activity = useAsync(() => api.admin.activity(), []);
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<AdminUser | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  usePolling(() => {
    api.admin.users().then((d) => data.setData(d), () => {});
    api.admin.activity().then((d) => activity.setData(d), () => {});
  }, REFRESH_MS);

  const users = data.data?.users ?? [];
  const defaultLimit = data.data?.defaultLimit ?? 0;
  const visible = useMemo(
    () =>
      users.filter((u) => {
        if (filter === 'online' && !u.online) return false;
        if (filter === 'never' && u.lastSeenAt) return false;
        if (filter === 'paused' && u.status !== 'disabled') return false;
        const q = query.trim().toLowerCase();
        return !q || `${u.email} ${u.name}`.toLowerCase().includes(q);
      }),
    [users, filter, query],
  );

  if (me && !me.isAdmin) return <Navigate to="/" replace />;

  const apply = async (p: Promise<{ users: AdminUser[] }>, done?: string) => {
    try {
      const res = await p;
      data.setData({ ...data.data!, users: res.users });
      if (done) toast(done, 'success');
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    }
  };
  const invite = (email: string) => apply(api.admin.addUser({ email }), `Invited ${email}`).then((ok) => ok && activity.reload());

  const online = users.filter((u) => u.online).length;
  const today = users.reduce((acc, u) => ({ requests: acc.requests + u.usage.today.requests, tokens: acc.tokens + u.usage.today.tokens }), { requests: 0, tokens: 0 });
  const completed = users.reduce((n, u) => n + u.stats.completed, 0);
  const inProgress = users.reduce((n, u) => n + u.stats.inProgress, 0);
  const counts: Record<Filter, number> = {
    all: users.length,
    online,
    never: users.filter((u) => !u.lastSeenAt).length,
    paused: users.filter((u) => u.status === 'disabled').length,
  };
  const selectedUser = users.find((u) => u.email === selected) ?? null;

  return (
    <motion.div variants={stagger.container} initial="hidden" animate="show">
      <PageHeader title="Admin" subtitle="Who uses Interview Sim, when they sign in, how much they practise and how much AI they use. Only you can see this page." />

      <motion.section variants={stagger.item} className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile icon={Activity} hue="#34d399" label="Online now" value={online} sub={`of ${users.length} people`} pulse={online > 0} loading={!data.data} />
        <Tile icon={Users} hue="#60a5fa" label="People with access" value={users.filter((u) => u.status === 'active').length} sub={`${counts.never} never signed in`} loading={!data.data} />
        <Tile icon={MessageSquareText} hue="#22d3ee" label="Interviews done" value={completed} sub={`${inProgress} in progress`} loading={!data.data} />
        <Tile icon={Bot} hue="#fbbf24" label="AI requests today" value={today.requests} sub={`${compact(today.tokens)} tokens`} loading={!data.data} />
      </motion.section>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.65fr_1fr]">
        <motion.div variants={stagger.item}>
          <Card className="p-5 sm:p-6">
            <SectionTitle icon={<Users className="size-5" />} action={<span className="text-xs text-ink-400">Updates every 30 s</span>}>
              People
            </SectionTitle>
            <div className="relative">
              <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-400" />
              <input className="field pl-10 text-sm" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
              {(
                [
                  ['all', 'All'],
                  ['online', 'Online'],
                  ['never', 'Never signed in'],
                  ['paused', 'Paused'],
                ] as const
              ).map(([key, label]) => (
                <Chip key={key} active={filter === key} onClick={() => setFilter(key)}>
                  <span className="whitespace-nowrap">
                    {label} <span className="text-ink-400 tabular-nums">{counts[key]}</span>
                  </span>
                </Chip>
              ))}
            </div>

            {data.loading && !data.data ? (
              <div className="mt-4 space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : data.error ? (
              <p className="mt-4 text-sm text-bad">{data.error}</p>
            ) : (
              <motion.ul layout className="mt-4 space-y-2">
                <AnimatePresence initial={false}>
                  {visible.map((u) => (
                    <UserRow key={u.email} u={u} isMe={u.email === me?.email} onOpen={() => setSelected(u.email)} />
                  ))}
                </AnimatePresence>
                {!visible.length && <li className="py-8 text-center text-sm text-ink-400">Nobody matches.</li>}
              </motion.ul>
            )}
          </Card>
        </motion.div>

        <motion.div variants={stagger.item} className="space-y-4">
          <InviteCard defaultLimit={defaultLimit} devMode={!!me?.devMode} via={me?.via} onInvite={(u) => apply(api.admin.addUser(u), `Invited ${u.email}`)} />
          <ActivityCard events={activity.data?.events} loading={activity.loading && !activity.data} known={new Set(users.map((u) => u.email))} onInvite={invite} />
          <Card className="p-5 sm:p-6">
            <SectionTitle icon={<Gauge className="size-5" />}>Groq quota</SectionTitle>
            <QuotaPanel />
          </Card>
        </motion.div>
      </div>

      <UserDetailModal
        user={selectedUser}
        isMe={selectedUser?.email === me?.email}
        devMode={!!me?.devMode}
        defaultLimit={defaultLimit}
        onClose={() => setSelected(null)}
        onLimit={(email, dailyLimit) => apply(api.admin.updateUser(email, { dailyLimit }), `Daily limit for ${email} updated`)}
        onStatus={(email, status) => apply(api.admin.updateUser(email, { status }), status === 'active' ? `Restored ${email}` : `Paused ${email}`)}
        onRemove={(u) => {
          setSelected(null);
          setToRemove(u);
        }}
      />

      <RemoveModal
        user={toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={async (deleteData) => {
          if (toRemove && (await apply(api.admin.removeUser(toRemove.email, deleteData), `Removed ${toRemove.email}`))) setToRemove(null);
        }}
      />
    </motion.div>
  );
}

function Tile({ icon: Icon, hue, label, value, sub, pulse, loading }: { icon: typeof Users; hue: string; label: string; value: number; sub: string; pulse?: boolean; loading: boolean }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink-400">{label}</span>
        <span className="relative rounded-lg p-1.5" style={{ background: `${hue}1a`, color: hue }}>
          {pulse && <span className="absolute inset-0 animate-ping rounded-lg" style={{ background: `${hue}33` }} />}
          <Icon className="relative size-4" />
        </span>
      </div>
      <div className="mt-3 font-display text-3xl font-semibold tabular-nums">{loading ? '–' : <CountUp value={value} />}</div>
      <div className="mt-1 text-xs text-ink-400">{loading ? '' : sub}</div>
    </Card>
  );
}

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) return null;
  const pct = limit ? Math.min(100, (used / limit) * 100) : 100;
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
      <motion.div
        className="h-full rounded-full"
        style={{ background: pct > 85 ? '#fb7185' : pct > 60 ? '#fbbf24' : 'linear-gradient(90deg,#3b82f6,#22d3ee)' }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}

function UserRow({ u, isMe, onOpen }: { u: AdminUser; isMe: boolean; onOpen: () => void }) {
  const p = presence(u);
  return (
    <motion.li layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }}>
      <button
        onClick={onOpen}
        className={cx(
          'group flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors sm:p-3.5',
          u.status === 'disabled' ? 'border-warn/20 bg-warn/[0.03]' : 'border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]',
        )}
      >
        <StatusAvatar u={u} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{u.name || u.email}</span>
            {u.role === 'admin' && <Badge color="#34d399">Admin</Badge>}
            {isMe && <Badge color="#60a5fa">You</Badge>}
          </div>
          <div className="truncate text-xs" style={{ color: p.color }}>
            {p.label}
            {u.lastVisit && <span className="text-ink-400"> · {describeDevice(u.lastVisit.userAgent)}</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-400">
            <span>
              <span className="text-ink-200 tabular-nums">{u.signIns}</span> sign-ins
            </span>
            <span>
              <span className="text-ink-200 tabular-nums">{u.stats.completed}</span> interviews
              {u.stats.inProgress > 0 && ` (+${u.stats.inProgress} open)`}
            </span>
            <span>
              <span className="text-ink-200 tabular-nums">{compact(u.usage.total.tokens)}</span> tokens total
            </span>
          </div>
        </div>
        <div className="hidden w-28 shrink-0 sm:block">
          <div className="text-right text-xs text-ink-400">
            AI today <span className="text-ink-200 tabular-nums">{u.usage.today.requests}</span>
            {u.effectiveLimit !== null ? <span className="tabular-nums">/{u.effectiveLimit}</span> : ''}
          </div>
          <UsageBar used={u.usage.today.requests} limit={u.effectiveLimit} />
        </div>
        <ChevronRight className="size-4 shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5" />
      </button>
    </motion.li>
  );
}

function InviteCard({ defaultLimit, devMode, via, onInvite }: { defaultLimit: number; devMode: boolean; via?: string; onInvite: (u: { email: string; name: string; dailyLimit: number | null }) => Promise<boolean> }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <Card className="p-5 sm:p-6">
      <SectionTitle icon={<UserPlus className="size-5" />}>Invite someone</SectionTitle>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          setBusy(true);
          const ok = await onInvite({ email: email.trim(), name: name.trim(), dailyLimit: limit === '' ? null : Number(limit) });
          setBusy(false);
          if (ok) {
            setEmail('');
            setName('');
            setLimit('');
          }
        }}
      >
        <input className="field" type="email" placeholder="their.email@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <input className="field" placeholder="Name (optional)" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          <input className="field" type="number" min={0} max={10000} placeholder={`${defaultLimit}/day`} value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Daily AI limit" />
        </div>
        <Button type="submit" variant="primary" className="w-full" disabled={!valid} loading={busy} icon={<UserPlus className="size-4" />}>
          Invite
        </Button>
      </form>
      <p className="mt-3 text-xs text-ink-400">
        {devMode
          ? 'Local dev mode: open a person and use “View as” to try the app as them.'
          : via === 'cloudflare'
            ? 'They sign in through Cloudflare Access with Google or an emailed code. Also add their email to the Access group in the Cloudflare dashboard.'
            : 'They open this site and use “Sign in with Google” with this email. Nothing else to set up.'}
      </p>
    </Card>
  );
}

const EVENT_STYLE: Record<ActivityEvent['kind'], { label: string; color: string; icon: typeof LogIn }> = {
  visit: { label: 'signed in', color: '#34d399', icon: LogIn },
  not_invited: { label: 'was turned away (not invited)', color: '#fb7185', icon: ShieldX },
  disabled: { label: 'tried while paused', color: '#fbbf24', icon: ShieldX },
};

function ActivityCard({ events, loading, known, onInvite }: { events?: ActivityEvent[]; loading: boolean; known: Set<string>; onInvite: (email: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events?.slice(0, 8);
  return (
    <Card className="p-5 sm:p-6">
      <SectionTitle icon={<History className="size-5" />}>Sign-ins & access attempts</SectionTitle>
      {loading ? (
        <Skeleton className="h-40" />
      ) : !events?.length ? (
        <p className="py-4 text-center text-sm text-ink-400">No activity yet.</p>
      ) : (
        <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px before:bg-white/8">
          {shown!.map((e, i) => {
            const st = EVENT_STYLE[e.kind];
            return (
              <motion.li key={`${e.kind}-${e.email}-${e.at}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }} className="relative flex gap-3">
                <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full ring-4 ring-ink-900" style={{ background: `${st.color}22`, color: st.color }}>
                  <st.icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate">
                    <span className="font-medium">{e.email}</span> <span style={{ color: st.color }}>{st.label}</span>
                  </div>
                  <div className="text-xs text-ink-400">
                    {relativeDate(e.at)}
                    {e.kind === 'visit' && e.lastAt !== e.at && ` · ${spanLabel(e.at, e.lastAt)}`}
                    {e.kind === 'visit' && e.signedOutAt && ' · signed out'} · {describeDevice(e.userAgent)}
                    {e.ip && ` · ${e.ip}`}
                  </div>
                  {e.kind === 'not_invited' && !known.has(e.email) && (
                    <button className="mt-1 text-xs font-medium text-brand-soft hover:underline" onClick={() => onInvite(e.email)}>
                      Invite {e.email}
                    </button>
                  )}
                </div>
              </motion.li>
            );
          })}
        </ol>
      )}
      {events && events.length > 8 && (
        <button className="mt-4 text-xs font-medium text-brand-soft hover:underline" onClick={() => setAll((v) => !v)}>
          {all ? 'Show less' : `Show all ${events.length}`}
        </button>
      )}
    </Card>
  );
}

function UsageChart({ daily }: { daily: AdminUserDetail['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.requests));
  return (
    <div>
      <div className="flex h-28 items-end gap-[3px]">
        {daily.map((d, i) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end">
            <motion.div
              className={cx('w-full rounded-t-sm', d.requests ? 'bg-gradient-to-t from-brand to-cyan' : 'bg-white/[0.05]')}
              initial={{ height: 0 }}
              animate={{ height: d.requests ? `${Math.max(6, (d.requests / max) * 100)}%` : '3px' }}
              transition={{ duration: 0.6, delay: i * 0.012, ease: [0.16, 1, 0.3, 1] }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-lg bg-ink-800 px-2 py-1 text-[11px] whitespace-nowrap text-ink-100 shadow-lg ring-1 ring-white/10 group-hover:block">
              {new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: {d.requests} req · {compact(d.tokens)} tok
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-400">
        <span>30 days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
      <div className="text-xs text-ink-400">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-400">{sub}</div>}
    </div>
  );
}

function UserDetailModal({
  user,
  isMe,
  devMode,
  defaultLimit,
  onClose,
  onLimit,
  onStatus,
  onRemove,
}: {
  user: AdminUser | null;
  isMe: boolean;
  devMode: boolean;
  defaultLimit: number;
  onClose: () => void;
  onLimit: (email: string, v: number | null) => Promise<boolean>;
  onStatus: (email: string, s: 'active' | 'disabled') => Promise<boolean>;
  onRemove: (u: AdminUser) => void;
}) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState('');
  const email = user?.email;

  useEffect(() => {
    if (!email) return;
    setDetail(null);
    setError(null);
    api.admin.user(email).then(setDetail, (e: Error) => setError(e.message));
  }, [email]);
  useEffect(() => setLimit(user?.dailyLimit == null ? '' : String(user.dailyLimit)), [user?.dailyLimit, email]);

  const u = detail?.user && detail.user.email === email ? { ...detail.user, ...user! } : user;
  const p = u ? presence(u) : null;
  const tone = u?.stats.avgScore != null ? scoreTone(u.stats.avgScore) : null;
  const saveLimit = () => {
    if (!u) return;
    const next = limit === '' ? null : Math.max(0, Math.round(Number(limit)));
    if (next !== u.dailyLimit && !Number.isNaN(next)) onLimit(u.email, next);
  };

  return (
    <Modal open={!!user} onClose={onClose} title={u?.name || u?.email || ''} className="max-w-3xl">
      {u && p && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusAvatar u={u} />
            <div className="min-w-0 flex-1">
              {u.name && <div className="truncate text-sm text-ink-300">{u.email}</div>}
              <div className="text-sm" style={{ color: p.color }}>
                {p.label}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {u.role === 'admin' ? <Badge color="#34d399">Admin</Badge> : <Badge>Member</Badge>}
              {isMe && <Badge color="#60a5fa">You</Badge>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="Sign-ins" value={u.signIns} sub={u.firstSeenAt ? `first ${formatDateTime(u.firstSeenAt)}` : 'never signed in'} />
            <Kpi
              label="Interviews"
              value={u.stats.completed}
              sub={`${u.stats.inProgress} in progress${u.stats.avgScore != null ? ` · avg ${u.stats.avgScore} · best ${u.stats.bestScore}` : ''}`}
            />
            <Kpi label="AI today" value={`${u.usage.today.requests}${u.effectiveLimit !== null ? `/${u.effectiveLimit}` : ''}`} sub={`${compact(u.usage.today.tokens)} tokens`} />
            <Kpi label="AI all time" value={compact(u.usage.total.requests)} sub={`${compact(u.usage.total.tokens)} tokens · 7d ${u.usage.week.requests} · 30d ${u.usage.month.requests}`} />
          </div>

          <section>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-200">
              <Bot className="size-4 text-brand-soft" /> AI requests, last 30 days
            </h4>
            {detail ? <UsageChart daily={detail.daily} /> : <Skeleton className="h-28" />}
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <section>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-200">
                <LogIn className="size-4 text-brand-soft" /> Sign-in history
              </h4>
              {error ? (
                <p className="text-sm text-bad">{error}</p>
              ) : !detail ? (
                <Skeleton className="h-32" />
              ) : !detail.visits.length ? (
                <p className="text-sm text-ink-400">Has not signed in yet.</p>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {detail.visits.map((v, i) => {
                    const live = i === 0 && u.online;
                    const Device = isMobileUa(v.userAgent) ? Smartphone : Monitor;
                    return (
                      <li key={v.id} className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-xs">
                        <Device className="mt-0.5 size-4 shrink-0 text-ink-400" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-ink-100">{formatDateTime(v.startedAt)}</span>
                            {live && <Badge color="#34d399">Active now</Badge>}
                            {v.signedOutAt && <Badge color="#9badc9">Signed out</Badge>}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-2 text-ink-400">
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" /> {spanLabel(v.startedAt, v.lastAt)}
                            </span>
                            <span>{describeDevice(v.userAgent)}</span>
                            {v.ip && (
                              <span className="flex items-center gap-1">
                                <Globe className="size-3" /> {v.ip}
                              </span>
                            )}
                            {v.via && <span>via {v.via === 'dev' ? 'local dev' : v.via}</span>}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-200">
                <MessageSquareText className="size-4 text-brand-soft" /> Interviews
                {tone && (
                  <span className="ml-auto text-xs font-normal text-ink-400">
                    avg <span style={{ color: tone.color }}>{u.stats.avgScore}</span>
                  </span>
                )}
              </h4>
              {!detail ? (
                <Skeleton className="h-32" />
              ) : !detail.sessions.length ? (
                <p className="text-sm text-ink-400">No interviews yet.</p>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {detail.sessions.map((s) => {
                    const t = s.overallScore != null ? scoreTone(s.overallScore) : null;
                    const row = (
                      <>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ink-100">{s.topic}</span>
                          <span className="text-ink-400">{relativeDate(s.createdAt)}</span>
                        </span>
                        {s.status === 'completed' ? (
                          <span className="font-display text-base font-semibold tabular-nums" style={{ color: t?.color }}>
                            {s.overallScore ?? '–'}
                          </span>
                        ) : (
                          <Badge color="#fbbf24">In progress</Badge>
                        )}
                      </>
                    );
                    // Only your own reports open; for others you see the listing, not their answers.
                    return (
                      <li key={s.id}>
                        {isMe && s.status === 'completed' ? (
                          <Link to={`/report/${s.id}`} onClick={onClose} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-xs hover:border-white/15">
                            {row}
                          </Link>
                        ) : (
                          <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-xs">{row}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {!isMe && <p className="mt-2 text-[11px] text-ink-400">Topics and scores only; answers stay private to them.</p>}
            </section>
          </div>

          {!u.locked ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
              <label className="flex items-center gap-2 text-xs text-ink-400">
                Daily AI limit
                <input
                  className="field h-9 w-24 px-2.5 py-1 text-sm"
                  type="number"
                  min={0}
                  max={10000}
                  placeholder={String(defaultLimit)}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  onBlur={saveLimit}
                  onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                />
              </label>
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {devMode && u.status === 'active' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Eye className="size-4" />}
                    onClick={() => {
                      setDevUser(u.email);
                      location.href = '/';
                    }}
                  >
                    View as
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={u.status === 'disabled' ? <Play className="size-4" /> : <Pause className="size-4" />} onClick={() => onStatus(u.email, u.status === 'disabled' ? 'active' : 'disabled')}>
                  {u.status === 'disabled' ? 'Restore access' : 'Pause access'}
                </Button>
                <Button size="sm" variant="ghost" className="text-bad hover:bg-bad/10" icon={<Trash2 className="size-4" />} onClick={() => onRemove(u)}>
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <p className="border-t border-white/5 pt-4 text-xs text-ink-400">Admins from ADMIN_EMAILS have no daily limit and can't be paused or removed here.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

function RemoveModal({ user, onClose, onConfirm }: { user: AdminUser | null; onClose: () => void; onConfirm: (deleteData: boolean) => Promise<void> }) {
  const [deleteData, setDeleteData] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={!!user} onClose={onClose} title={`Remove ${user?.name || user?.email || ''}?`}>
      <p className="text-sm text-ink-300">They lose access right away. You can invite them again later.</p>
      <div className="mt-5 rounded-xl border border-white/8 p-3">
        <Toggle
          checked={deleteData}
          onChange={setDeleteData}
          label="Also delete their data"
          description={`${user?.stats.sessions ?? 0} interviews, custom topics, usage and sign-in history. This can't be undone.`}
        />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          loading={busy}
          icon={<Trash2 className="size-4" />}
          onClick={async () => {
            setBusy(true);
            await onConfirm(deleteData);
            setBusy(false);
            setDeleteData(false);
          }}
        >
          Remove
        </Button>
      </div>
    </Modal>
  );
}
