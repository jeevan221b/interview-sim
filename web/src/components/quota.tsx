import { motion } from 'motion/react';
import { CircleAlert, Gauge, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { useAsync, useMe } from '../lib/hooks';
import type { ModelQuota, Quota } from '../lib/types';
import { Badge, Button, useToast } from './ui';

export function useQuota() {
  return useAsync(() => api.quota(), []);
}

const shortModel = (m: string) => m.replace(/^openai\//, '').replace(/^qwen\//, '');
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function tone(left: number | null, limit: number | null) {
  if (left === null || !limit) return { color: '#6a7b9c', label: 'Not checked yet' };
  const pct = left / limit;
  if (pct > 0.4) return { color: '#34d399', label: 'Plenty left' };
  if (pct > 0.15) return { color: '#fbbf24', label: 'Running low' };
  return { color: '#fb7185', label: 'Almost out' };
}

/** Rough AI request count for one interview, used to warn before starting. */
export function estimateCalls(questionCount: number, grading: 'each' | 'end' = 'each', followUps = true) {
  if (grading === 'end') return 2 + Math.ceil(questionCount / 3);
  return 2 + questionCount + (followUps ? Math.ceil(questionCount / 2) : 0);
}

/** Requests still available across the model chain (models currently rate-limited count as 0). */
export function requestsLeft(q: Quota | null) {
  if (!q?.models.length) return null;
  if (q.models.every((m) => m.requestsRemaining === null)) return null;
  return q.models.reduce((n, m) => n + (m.limitedUntil ? 0 : (m.requestsRemaining ?? 0)), 0);
}

function ModelRow({ m, index }: { m: ModelQuota; index: number }) {
  const t = m.limitedUntil ? { color: '#fb7185', label: `Limited until ${time(m.limitedUntil)}` } : tone(m.requestsRemaining, m.requestsLimit);
  const pct = m.requestsLimit && m.requestsRemaining !== null ? (m.requestsRemaining / m.requestsLimit) * 100 : 0;
  return (
    <li className={cx('rounded-xl border p-3', index === 0 ? 'border-brand-soft/30 bg-brand/[0.06]' : 'border-white/5')}>
      <div className="flex items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs font-semibold">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{shortModel(m.model)}</span>
        <Badge color={t.color}>{t.label}</Badge>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div className="h-full rounded-full" style={{ background: t.color }} initial={{ width: 0 }} animate={{ width: `${m.limitedUntil ? 0 : pct}%` }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-ink-400">
        <span>
          {m.requestsRemaining !== null ? (
            <>
              <span className="text-ink-200 tabular-nums">{m.requestsRemaining}</span> / {m.requestsLimit} requests left (24h)
            </>
          ) : (
            'No reading yet'
          )}
        </span>
        <span>
          This app today: <span className="text-ink-200 tabular-nums">{m.usedToday.requests}</span> calls · <span className="tabular-nums">{(m.usedToday.tokens / 1000).toFixed(1)}k</span> tokens
        </span>
      </div>
    </li>
  );
}

/** Full per-model view for the Settings page. */
export function QuotaPanel() {
  const quota = useQuota();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      quota.setData(await api.refreshQuota());
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setRefreshing(false);
    }
  };

  if (quota.data && !quota.data.provider) return <p className="text-sm text-ink-400">Quota tracking is available when Groq is the AI provider.</p>;

  return (
    <div>
      <ol className="space-y-2">
        {quota.data?.models.map((m, i) => <ModelRow key={m.model} m={m} index={i} />)}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-xs text-ink-400">
          Models are tried in order; when one hits its limit the next takes over. The limits are shared with CV Forge (same Groq key) and update after every AI call.
        </p>
        <Button size="sm" icon={<RefreshCw className={cx('size-4', refreshing && 'animate-spin')} />} onClick={refresh} disabled={refreshing}>
          Check now
        </Button>
      </div>
    </div>
  );
}

/**
 * One-line status for the Ready step, with a warning when the interview may not fit:
 * the shared Groq quota for the admin, the personal daily allowance for everyone else.
 */
export function QuotaSummary({ needed }: { needed: number }) {
  const me = useMe().data;
  if (!me) return null;
  return me.isAdmin ? <GroqSummary needed={needed} /> : <AllowanceSummary needed={needed} used={me.usage.used} limit={me.usage.limit} />;
}

function AllowanceSummary({ needed, used, limit }: { needed: number; used: number; limit: number | null }) {
  if (limit === null) return null;
  const left = Math.max(0, limit - used);
  const short = left < needed;
  return (
    <div className={cx('mt-4 flex gap-2 rounded-xl border p-3 text-xs', short ? 'border-warn/30 bg-warn/10 text-warn' : 'border-white/8 bg-white/[0.02] text-ink-300')}>
      {short ? <CircleAlert className="size-4 shrink-0" /> : <Gauge className="size-4 shrink-0 text-brand-soft" />}
      <span>
        {short
          ? `This interview needs about ${needed} AI requests and you have ${left} left today. Try grading at the end or fewer questions.`
          : `Uses about ${needed} of your ${left} AI requests left today.`}
      </span>
    </div>
  );
}

function GroqSummary({ needed }: { needed: number }) {
  const quota = useQuota();
  const q = quota.data;
  if (!q?.provider) return null;
  const left = requestsLeft(q);
  const active = q.models.find((m) => !m.limitedUntil);
  const short = left !== null && left < needed;
  return (
    <div className={cx('mt-4 flex gap-2 rounded-xl border p-3 text-xs', short ? 'border-warn/30 bg-warn/10 text-warn' : 'border-white/8 bg-white/[0.02] text-ink-300')}>
      {short ? <CircleAlert className="size-4 shrink-0" /> : <Gauge className="size-4 shrink-0 text-brand-soft" />}
      <span>
        {left === null
          ? `Uses about ${needed} AI requests. Quota not checked yet (see Settings).`
          : short
            ? `This interview needs about ${needed} AI requests but only ${left} are left right now. Try grading at the end, or fewer questions.`
            : `Uses about ${needed} AI requests · ${left} left${active ? ` (now on ${shortModel(active.model)})` : ''}.`}
      </span>
    </div>
  );
}
