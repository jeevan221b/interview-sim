import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CornerDownRight,
  Download,
  Gauge,
  Lightbulb,
  ListChecks,
  MessageCircleWarning,
  Printer,
  RotateCcw,
  Sparkles,
  Target,
  Timer,
  Trash2,
  TrendingUp,
  Volume2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { splitFillers } from '../../../shared/metrics.js';
import { RadarChart, ScoreBar, ScoreRing } from '../components/charts';
import { Badge, Button, Card, Modal, SectionTitle, Skeleton, stagger, useToast } from '../components/ui';
import { api } from '../lib/api';
import { download, reportMarkdown } from '../lib/export';
import { DIMENSION_LABELS, HIRING_SIGNAL, LEVEL_LABELS, cx, formatDuration, scoreTone } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { useSettings } from '../lib/settings';
import { cancelSpeech, speak, ttsSupported } from '../lib/speech';
import type { Question, Session } from '../lib/types';

export function ReportPage() {
  const { id = '' } = useParams();
  const { data: session, error, loading } = useAsync(() => api.session(id), [id]);
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }
  if (error || !session) {
    return (
      <div className="py-24 text-center">
        <CircleAlert className="mx-auto size-10 text-bad" />
        <p className="mt-3">{error || 'Report not found'}</p>
        <Button className="mt-6" onClick={() => navigate('/history')}>
          Back to history
        </Button>
      </div>
    );
  }
  if (!session.report) {
    return (
      <div className="py-24 text-center">
        <p className="text-lg">This interview isn't finished yet.</p>
        <Button variant="primary" className="mt-6" onClick={() => navigate(`/interview/${id}`)}>
          Resume interview
        </Button>
      </div>
    );
  }
  return <ReportView session={session} />;
}

function ReportView({ session: initial }: { session: Session }) {
  // Local copy so model answers fetched on demand show up in exports too.
  const [session, setSession] = useState(initial);
  const r = session.report!;
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [printAll, setPrintAll] = useState(false);
  const signal = HIRING_SIGNAL[r.hiringSignal];
  const isMock = r.provider === 'mock';
  const graded = session.questions.filter((q) => !q.answer?.skipped);

  const { topic, field = '', focus = '', level, type, role } = session.config;
  const retryQuery = new URLSearchParams({ topic, field, focus, level, type, role }).toString();

  return (
    <motion.div variants={stagger.container} initial="hidden" animate="show" className="space-y-5">
      {/* Hero */}
      <motion.section variants={stagger.item} className="glass gradient-border relative overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="absolute -top-24 -right-24 size-72 rounded-full blur-3xl" style={{ background: `${scoreTone(r.overallScore).color}22` }} />
        <div className="relative flex flex-col items-center gap-6 text-center md:flex-row md:text-left">
          <ScoreRing score={r.overallScore} size={170} />
          <div className="flex-1">
            <div className="flex flex-wrap items-center justify-center gap-2 md:justify-start">
              <Badge color={signal?.color}>{signal?.label}</Badge>
              <Badge>{session.config.topic}</Badge>
              <Badge>
                {LEVEL_LABELS[session.config.level]} · {session.config.type}
              </Badge>
              {isMock && <Badge color="#fbbf24">Mock interviewer</Badge>}
              {r.model && <Badge>{r.model.replace(/^[a-z]+\//, '')}</Badge>}
            </div>
            <h1 className="mt-3 font-display text-2xl leading-tight font-semibold sm:text-3xl">{r.headline}</h1>
            <p className="mt-3 max-w-2xl text-ink-300">{r.summary}</p>
            <p className="mt-3 text-xs text-ink-400">
              {new Date(session.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {graded.length} of {session.questions.length} answered
            </p>
          </div>
        </div>
        <div className="no-print relative mt-6 flex flex-wrap justify-center gap-2 md:justify-start">
          <Button variant="primary" size="sm" icon={<RotateCcw className="size-4" />} onClick={() => navigate(`/setup?${retryQuery}`)}>
            Practice again
          </Button>
          <Button size="sm" icon={<Download className="size-4" />} onClick={() => download(`interview-${session.config.topic.replace(/\W+/g, '-').toLowerCase()}-${session.createdAt.slice(0, 10)}.md`, reportMarkdown(session))}>
            Markdown
          </Button>
          <Button size="sm" icon={<Printer className="size-4" />} onClick={() => {
              // Expand every question so the PDF contains the full breakdown.
              setPrintAll(true);
              window.addEventListener('afterprint', () => setPrintAll(false), { once: true });
              setTimeout(() => window.print(), 450);
            }}>
            PDF
          </Button>
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
      </motion.section>

      {/* Scores */}
      <motion.section variants={stagger.item} className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card className="print-break flex flex-col items-center p-5 sm:p-6">
          <SectionTitle icon={<Target className="size-5" />}>Skill profile</SectionTitle>
          <RadarChart values={r.dimensions} />
        </Card>
        <Card className="print-break p-5 sm:p-6">
          <SectionTitle icon={<TrendingUp className="size-5" />}>Breakdown</SectionTitle>
          <div className="space-y-4">
            {Object.entries(r.dimensions).map(([k, v], i) => (
              <ScoreBar key={k} label={DIMENSION_LABELS[k] ?? k} value={v} delay={i * 0.06} />
            ))}
          </div>
        </Card>
      </motion.section>

      {/* Strengths / improvements */}
      <motion.section variants={stagger.item} className="grid gap-5 md:grid-cols-2">
        <InsightList title="Strengths" icon={<CheckCircle2 className="size-5" />} color="#34d399" items={r.strengths} />
        <InsightList title="Improve next" icon={<Lightbulb className="size-5" />} color="#fbbf24" items={r.improvements} />
      </motion.section>

      {/* Delivery */}
      <motion.section variants={stagger.item}>
        <Card className="print-break p-5 sm:p-6">
          <SectionTitle icon={<Gauge className="size-5" />}>How you sounded</SectionTitle>
          <div className="grid gap-5 md:grid-cols-[1.3fr_1fr]">
            <div className="space-y-5">
              <PaceMeter wpm={r.delivery.avgWpm} />
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: MessageCircleWarning, label: 'Filler words', value: r.delivery.totalFillers, sub: `${r.delivery.avgFillerRate}% of words`, bad: r.delivery.avgFillerRate > 4 },
                  { icon: Timer, label: 'Speaking time', value: formatDuration(r.delivery.speakingSec), sub: `${r.delivery.avgWords} words / answer` },
                  { icon: Sparkles, label: 'Long pauses', value: r.delivery.totalPauses, sub: 'over 2.5s', bad: r.delivery.totalPauses > r.delivery.answered * 3 },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <m.icon className={cx('size-4', m.bad ? 'text-warn' : 'text-ink-400')} />
                    <div className={cx('mt-2 font-display text-xl font-semibold tabular-nums', m.bad && 'text-warn')}>{m.value}</div>
                    <div className="text-xs text-ink-300">{m.label}</div>
                    <div className="text-[11px] text-ink-400">{m.sub}</div>
                  </div>
                ))}
              </div>
              <FillerCloud questions={session.questions} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-ink-200">Communication tips</h3>
              <ul className="space-y-2">
                {r.communicationTips.map((t, i) => (
                  <motion.li key={i} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className="flex gap-2 text-sm text-ink-300">
                    <ArrowRight className="mt-0.5 size-4 shrink-0 text-cyan" /> {t}
                  </motion.li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </motion.section>

      {/* Questions */}
      <motion.section variants={stagger.item}>
        <Card className="p-5 sm:p-6">
          <SectionTitle icon={<ListChecks className="size-5" />}>Question by question</SectionTitle>
          <div className="space-y-2">
            {session.questions.map((q) => (
              <QuestionItem
                key={q.id}
                q={q}
                n={session.questions.filter((x) => !x.followUpOf).findIndex((x) => x.id === (q.followUpOf ?? q.id)) + 1}
                expandAll={printAll}
                sessionId={session.id}
                onUpdate={setSession}
              />
            ))}
          </div>
        </Card>
      </motion.section>

      {/* Study + next steps */}
      <motion.section variants={stagger.item} className="grid gap-5 md:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <SectionTitle icon={<BookOpen className="size-5" />}>Study next</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {r.studyTopics.map((t) => (
              <span key={t} className="rounded-lg border border-brand-soft/25 bg-brand/10 px-3 py-1.5 text-sm text-brand-soft">
                {t}
              </span>
            ))}
          </div>
        </Card>
        <InsightList title="Next session" icon={<RotateCcw className="size-5" />} color="#22d3ee" items={r.nextSteps} />
      </motion.section>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this interview?">
        <p className="text-sm text-ink-300">The report and all answers will be removed permanently.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={<Trash2 className="size-4" />}
            onClick={async () => {
              try {
                await api.deleteSession(session.id);
                toast('Interview deleted', 'success');
                navigate('/history');
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            }}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </motion.div>
  );
}

function InsightList({ title, icon, color, items }: { title: string; icon: React.ReactNode; color: string; items: string[] }) {
  return (
    <Card className="print-break p-5 sm:p-6">
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold" style={{ color }}>
        {icon} {title}
      </h2>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
           
            transition={{ delay: i * 0.08 }}
            className="flex gap-3 text-sm text-ink-200"
          >
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: `${color}1f`, color }}>
              {i + 1}
            </span>
            {item}
          </motion.li>
        ))}
      </ul>
    </Card>
  );
}

function PaceMeter({ wpm }: { wpm: number }) {
  const min = 60;
  const max = 220;
  const pos = wpm ? Math.min(100, Math.max(0, ((wpm - min) / (max - min)) * 100)) : null;
  const zone = [((120 - min) / (max - min)) * 100, ((160 - min) / (max - min)) * 100];
  const verdict = !wpm ? 'No spoken answers' : wpm < 110 ? 'A bit slow' : wpm > 170 ? 'A bit fast' : 'Comfortable pace';
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm text-ink-300">Speaking pace</span>
        <span className="text-sm">
          <span className="font-display text-xl font-semibold tabular-nums">{wpm || '–'}</span> <span className="text-ink-400">wpm · {verdict}</span>
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-gradient-to-r from-warn/30 via-good/40 to-warn/30">
        <div className="absolute inset-y-0 rounded-full border border-good/60 bg-good/15" style={{ left: `${zone[0]}%`, width: `${zone[1] - zone[0]}%` }} />
        {pos !== null && (
          <motion.div
            className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-ink-900 bg-white shadow-[0_0_14px_rgb(255_255_255/0.6)]"
            initial={{ left: '0%' }}
            animate={{ left: `${pos}%` }}
           
            transition={{ type: 'spring', stiffness: 80, damping: 14 }}
          />
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-400">
        <span>Slow</span>
        <span>Ideal 120–160</span>
        <span>Fast</span>
      </div>
    </div>
  );
}

function FillerCloud({ questions }: { questions: Question[] }) {
  const totals: Record<string, number> = {};
  questions.forEach((q) => Object.entries(q.answer?.metrics.fillers ?? {}).forEach(([w, n]) => (totals[w] = (totals[w] || 0) + n)));
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return <p className="text-sm text-good">No filler words detected. Nice and clean.</p>;
  const top = sorted[0][1];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-400">Most used:</span>
      {sorted.slice(0, 8).map(([word, n]) => (
        <span key={word} className="rounded-lg bg-warn/10 px-2 py-1 text-warn" style={{ fontSize: 12 + (n / top) * 6, opacity: 0.6 + (n / top) * 0.4 }}>
          “{word}” <span className="text-xs opacity-70">×{n}</span>
        </span>
      ))}
    </div>
  );
}

function QuestionItem({ q, n, expandAll, sessionId, onUpdate }: { q: Question; n: number; expandAll: boolean; sessionId: string; onUpdate: (s: Session) => void }) {
  const toast = useToast();
  const [fetchingModel, setFetchingModel] = useState(false);
  const fetchModelAnswer = async () => {
    setFetchingModel(true);
    try {
      const res = await api.modelAnswer(sessionId, q.id);
      setShowModel(true);
      onUpdate(res.session);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setFetchingModel(false);
    }
  };
  const [openState, setOpen] = useState(false);
  const [showModelState, setShowModel] = useState(false);
  const open = openState || expandAll;
  const showModel = showModelState || expandAll;
  const [speaking, setSpeaking] = useState(false);
  const [settings] = useSettings();
  const ev = q.evaluation;
  const skipped = q.answer?.skipped;
  const score = ev ? Math.round(ev.overall * 10) : 0;
  const tone = scoreTone(score);

  return (
    <div className={cx('print-break overflow-hidden rounded-2xl border transition-colors', open ? 'border-white/10 bg-white/[0.03]' : 'border-white/5 hover:border-white/10', q.followUpOf && 'ml-4 sm:ml-8')}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-3.5 text-left sm:p-4">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl font-display text-sm font-semibold tabular-nums"
          style={skipped ? { background: 'rgb(255 255 255 / 0.05)', color: 'var(--color-ink-400)' } : { background: `${tone.color}1a`, color: tone.color }}
        >
          {skipped ? '–' : ev?.overall.toFixed(1)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-ink-400">
            {q.followUpOf ? (
              <span className="flex items-center gap-1 text-accent">
                <CornerDownRight className="size-3" /> Follow-up
              </span>
            ) : (
              <span>Q{n}</span>
            )}
            <span>· {q.focus}</span>
            {skipped && <span className="text-warn">· skipped</span>}
          </div>
          <div className={cx('mt-0.5 text-sm font-medium sm:text-[15px]', !open && 'line-clamp-2')}>{q.text}</div>
        </div>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="shrink-0">
          <ChevronDown className="size-5 text-ink-400" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="space-y-4 px-4 pb-5 sm:px-5">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs font-medium tracking-wide text-ink-400 uppercase">
                  <span>Your answer</span>
                  {q.answer && !skipped && (
                    <span className="font-normal tracking-normal normal-case">
                      {q.answer.metrics.wordCount} words
                      {q.answer.metrics.wpm ? ` · ${q.answer.metrics.wpm} wpm` : ' · typed'} · {q.answer.metrics.fillerCount} fillers
                    </span>
                  )}
                </div>
                <p className="rounded-xl bg-black/20 p-3.5 text-sm leading-relaxed text-ink-200">
                  {skipped
                    ? <span className="text-ink-400 italic">No answer given.</span>
                    : splitFillers(q.answer?.transcript ?? '').map((part, i) => (part.filler ? <mark key={i} className="filler">{part.text}</mark> : <span key={i}>{part.text}</span>))}
                </p>
              </div>

              {ev && !skipped && (
                <>
                  <p className="text-sm text-ink-200">{ev.summary}</p>

                  <div className="grid grid-cols-5 gap-1.5">
                    {Object.entries(ev.scores).map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-white/[0.03] px-1 py-2 text-center">
                        <div className="text-sm font-semibold tabular-nums" style={{ color: scoreTone(v * 10).color }}>
                          {v}
                        </div>
                        <div className="truncate text-[10px] text-ink-400">{DIMENSION_LABELS[k]}</div>
                      </div>
                    ))}
                  </div>

                  {(ev.coveredPoints.length > 0 || ev.missedPoints.length > 0) && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <PointList title="Covered" items={ev.coveredPoints} good />
                      <PointList title="Missed" items={ev.missedPoints} />
                    </div>
                  )}

                  {ev.star && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-ink-400">STAR:</span>
                      {(['situation', 'task', 'action', 'result'] as const).map((k) => (
                        <Badge key={k} color={ev.star![k] ? '#34d399' : '#fb7185'}>
                          {ev.star![k] ? <Check className="size-3" /> : <X className="size-3" />}
                          <span className="capitalize">{k}</span>
                        </Badge>
                      ))}
                    </div>
                  )}

                  {ev.improvements.length > 0 && (
                    <ul className="space-y-1.5">
                      {ev.improvements.map((t, i) => (
                        <li key={i} className="flex gap-2 text-sm text-ink-300">
                          <Lightbulb className="mt-0.5 size-4 shrink-0 text-warn" /> {t}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {ev?.modelAnswer && (
                <div className="rounded-xl border border-brand-soft/20 bg-brand/[0.06]">
                  <button onClick={() => setShowModel((v) => !v)} className="flex w-full items-center justify-between p-3.5 text-left text-sm font-medium text-brand-soft">
                    <span className="flex items-center gap-2">
                      <Sparkles className="size-4" /> Model answer
                    </span>
                    <motion.span animate={{ rotate: showModel ? 180 : 0 }}>
                      <ChevronDown className="size-4" />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {showModel && (
                      <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                        <div className="px-3.5 pb-3.5">
                          <p className="text-sm leading-relaxed whitespace-pre-line text-ink-200">{ev.modelAnswer}</p>
                          {ttsSupported && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="mt-2 -ml-2"
                              icon={<Volume2 className="size-4" />}
                              onClick={async () => {
                                if (speaking) {
                                  cancelSpeech();
                                  return setSpeaking(false);
                                }
                                setSpeaking(true);
                                await speak(ev.modelAnswer, { voiceURI: settings.voiceURI, rate: settings.speechRate, lang: settings.language });
                                setSpeaking(false);
                              }}
                            >
                              {speaking ? 'Stop' : 'Listen'}
                            </Button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
              {ev && !ev.modelAnswer && (
                <Button size="sm" variant="ghost" className="print:hidden" icon={<Sparkles className="size-4 text-brand-soft" />} loading={fetchingModel} onClick={fetchModelAnswer}>
                  Show model answer
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PointList({ title, items, good }: { title: string; items: string[]; good?: boolean }) {
  if (!items.length) return <div />;
  return (
    <div className={cx('rounded-xl border p-3', good ? 'border-good/20 bg-good/[0.04]' : 'border-bad/20 bg-bad/[0.04]')}>
      <div className={cx('mb-2 text-xs font-medium', good ? 'text-good' : 'text-bad')}>{title}</div>
      <ul className="space-y-1.5">
        {items.map((p, i) => (
          <li key={i} className="flex gap-2 text-sm text-ink-200">
            {good ? <Check className="mt-0.5 size-3.5 shrink-0 text-good" /> : <X className="mt-0.5 size-3.5 shrink-0 text-bad" />}
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
