import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CalendarDays, Clock, LineChart, MessageSquareText, Play, Search, Target, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MiniRing, TrendChart } from '../components/charts';
import { Badge, Button, Card, Chip, CountUp, Modal, PageHeader, SectionTitle, Skeleton, useToast } from '../components/ui';
import { api } from '../lib/api';
import { relativeDate, roleLabel } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { topicMeta } from '../lib/topics';
import type { SessionSummary } from '../lib/types';

export function HistoryPage() {
  const sessions = useAsync(() => api.sessions(), []);
  const stats = useAsync(() => api.stats(), []);
  const navigate = useNavigate();
  const toast = useToast();
  const [topic, setTopic] = useState<string>('All');
  const [query, setQuery] = useState('');
  const [toDelete, setToDelete] = useState<SessionSummary | null>(null);
  const [weakLoading, setWeakLoading] = useState(false);

  const topics = useMemo(() => ['All', ...new Set((sessions.data ?? []).map((s) => s.config.topic))], [sessions.data]);
  const filtered = (sessions.data ?? []).filter(
    (s) => (topic === 'All' || s.config.topic === topic) && `${s.config.topic} ${s.config.field ?? ''} ${s.config.role} ${s.headline ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  );
  const trend = (stats.data?.trend ?? []).filter((p) => topic === 'All' || p.topic === topic);

  const remove = async () => {
    if (!toDelete) return;
    try {
      await api.deleteSession(toDelete.id);
      sessions.setData((sessions.data ?? []).filter((s) => s.id !== toDelete.id));
      stats.reload();
      toast('Interview deleted', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    setToDelete(null);
  };

  return (
    <div>
      <PageHeader
        title="History"
        subtitle="Every interview, every score. Track how you're improving."
        action={
          !!stats.data?.weakCount && (
            <Button
              loading={weakLoading}
              icon={<Target className="size-4" />}
              onClick={async () => {
                setWeakLoading(true);
                try {
                  const s = await api.createWeakSession({});
                  navigate(`/interview/${s.id}`);
                } catch (e) {
                  toast((e as Error).message, 'error');
                  setWeakLoading(false);
                }
              }}
            >
              Practice {stats.data.weakCount} weak answers
            </Button>
          )
        }
      />

      <div className="mb-5 grid grid-cols-3 gap-3">
        {[
          { label: 'Questions answered', value: stats.data?.questionsAnswered ?? 0, icon: MessageSquareText },
          { label: 'Minutes spoken', value: stats.data?.practiceMinutes ?? 0, icon: Clock },
          { label: 'Topics practiced', value: stats.data?.byTopic.length ?? 0, icon: CalendarDays },
        ].map((m) => (
          <Card key={m.label} className="p-4">
            <m.icon className="size-4 text-brand-soft" />
            <div className="mt-2 font-display text-2xl font-semibold tabular-nums">
              <CountUp value={m.value} />
            </div>
            <div className="text-xs text-ink-400">{m.label}</div>
          </Card>
        ))}
      </div>

      {trend.length > 1 && (
        <Card className="mb-5 p-5 sm:p-6">
          <SectionTitle icon={<LineChart className="size-5" />}>Progress{topic !== 'All' && ` · ${topic}`}</SectionTitle>
          <TrendChart key={topic} points={trend} height={180} onSelect={(id) => navigate(`/report/${id}`)} />
        </Card>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-400" />
          <input className="field pl-10" placeholder="Search interviews…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {topics.map((t) => (
            <Chip key={t} active={topic === t} onClick={() => setTopic(t)}>
              {t}
            </Chip>
          ))}
        </div>
      </div>

      {sessions.loading && !sessions.data ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="py-16 text-center">
          <MessageSquareText className="mx-auto size-10 text-ink-600" />
          <p className="mt-3 text-ink-300">{sessions.data?.length ? 'Nothing matches that filter.' : 'No interviews yet.'}</p>
          {!sessions.data?.length && (
            <Button variant="primary" className="mt-5" onClick={() => navigate('/setup')}>
              Start your first interview
            </Button>
          )}
        </Card>
      ) : (
        <motion.div layout className="space-y-2.5">
          <AnimatePresence mode="popLayout">
            {filtered.map((s, i) => {
              const Icon = topicMeta(s.config.topic, s.config.field).icon;
              const completed = s.status === 'completed';
              return (
                <motion.div
                  layout
                  key={s.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.04 } }}
                  exit={{ opacity: 0, x: -40, transition: { duration: 0.2 } }}
                >
                  <Card className="group flex items-center gap-3 p-3 transition-colors hover:bg-white/[0.04] sm:gap-4 sm:p-4">
                    <Link to={completed ? `/report/${s.id}` : `/interview/${s.id}`} className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                      <span className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] sm:flex">
                        <Icon className="size-5 text-brand-soft" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{s.config.topic}</span>
                          {!completed && <Badge color="#fbbf24">In progress</Badge>}
                          {s.provider === 'mock' && <Badge>mock</Badge>}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-ink-400">
                          {roleLabel(s.config.level, s.config.role)} · {s.answered}/{s.questionCount} answered · {relativeDate(s.createdAt)}
                        </div>
                        {s.headline && <div className="mt-1 hidden truncate text-sm text-ink-300 sm:block">{s.headline}</div>}
                      </div>
                      {completed ? (
                        <MiniRing score={s.overallScore} size={48} />
                      ) : (
                        <span className="flex size-12 items-center justify-center rounded-full bg-warn/10 text-warn">
                          <Play className="size-5" />
                        </span>
                      )}
                    </Link>
                    <div className="flex items-center">
                      <button onClick={() => setToDelete(s)} className="rounded-lg p-2 text-ink-400 opacity-100 transition-all hover:bg-bad/10 hover:text-bad sm:opacity-0 sm:group-hover:opacity-100" aria-label="Delete interview">
                        <Trash2 className="size-4" />
                      </button>
                      <ArrowRight className="hidden size-4 text-ink-400 transition-transform group-hover:translate-x-1 sm:block" />
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      )}

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title="Delete this interview?">
        <p className="text-sm text-ink-300">
          “{toDelete?.config.topic}” from {toDelete && relativeDate(toDelete.createdAt)} will be removed permanently.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setToDelete(null)}>
            Cancel
          </Button>
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={remove}>
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
