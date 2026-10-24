import { motion } from 'motion/react';
import { ArrowRight, AudioLines, Plus, Award, BrainCircuit, Flame, LineChart, MessageSquareText, Mic, Target, Timer, TrendingUp } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { MiniRing, TrendChart } from '../components/charts';
import { Badge, Button, Card, CountUp, SectionTitle, Skeleton, stagger, useToast } from '../components/ui';
import { Orb } from '../components/visuals';
import { api } from '../lib/api';
import { LEVEL_LABELS, relativeDate, scoreTone } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { FIELDS, TOPICS, customToTopic, topicMeta, useCustomTopics } from '../lib/topics';
import { useState } from 'react';

export function HomePage() {
  const stats = useAsync(() => api.stats(), []);
  const recent = useAsync(() => api.sessions(), []);
  const navigate = useNavigate();
  const toast = useToast();
  const [weakLoading, setWeakLoading] = useState(false);
  const { list: customList } = useCustomTopics();
  // Your own topics first, then a couple from each field so every domain is one tap away.
  const quick = [...customList.slice(0, 4).map(customToTopic), ...FIELDS.flatMap((f) => TOPICS.filter((t) => t.field === f.name).slice(0, 2))].slice(0, 16);
  const s = stats.data;
  const firstRun = s && s.completedSessions === 0;

  const practiceWeak = async () => {
    setWeakLoading(true);
    try {
      const session = await api.createWeakSession({});
      navigate(`/interview/${session.id}`);
    } catch (e) {
      toast((e as Error).message, 'error');
      setWeakLoading(false);
    }
  };

  return (
    <motion.div variants={stagger.container} initial="hidden" animate="show" className="space-y-6">
      {/* Hero */}
      <motion.section variants={stagger.item} className="glass gradient-border relative overflow-hidden rounded-3xl p-6 sm:p-10">
        <div className="relative z-10 grid items-center gap-8 md:grid-cols-[1.4fr_1fr]">
          <div>
            <Badge color="#60a5fa" className="mb-4">
              <AudioLines className="size-3" /> Voice-first mock interviews
            </Badge>
            <h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              Practice interviews <span className="gradient-text">out loud.</span>
            </h1>
            <p className="mt-4 max-w-lg text-base text-ink-300 sm:text-lg">
              Pick a topic, answer by voice, and get a detailed debrief: scores, missed points, model answers and how you sounded.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button variant="primary" size="lg" icon={<Mic className="size-5" />} onClick={() => navigate('/setup')}>
                Start an interview
              </Button>
              {!!s?.weakCount && (
                <Button size="lg" icon={<Target className="size-5" />} loading={weakLoading} onClick={practiceWeak}>
                  Practice weak spots
                  <span className="rounded-md bg-warn/15 px-1.5 text-xs text-warn">{s.weakCount}</span>
                </Button>
              )}
            </div>
          </div>
          <div className="hidden justify-center sm:flex md:justify-end">
            <Orb state="idle" size={240} />
          </div>
        </div>
      </motion.section>

      {/* Stat tiles */}
      <motion.section variants={stagger.item} className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stats.loading && !s
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)
          : [
              { icon: MessageSquareText, label: 'Interviews', value: s?.completedSessions ?? 0, hue: '#60a5fa' },
              { icon: TrendingUp, label: 'Average score', value: s?.avgScore ?? 0, hue: '#22d3ee', suffix: s?.avgScore == null ? '' : '/100' },
              { icon: Award, label: 'Best score', value: s?.bestScore ?? 0, hue: '#34d399' },
              { icon: Flame, label: 'Day streak', value: s?.streakDays ?? 0, hue: '#fb923c' },
            ].map(({ icon: Icon, label, value, hue, suffix }) => (
              <Card key={label} whileHover={{ y: -3 }} className="group p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink-400">{label}</span>
                  <span className="rounded-lg p-1.5 transition-transform group-hover:scale-110" style={{ background: `${hue}1a`, color: hue }}>
                    <Icon className="size-4" />
                  </span>
                </div>
                <div className="mt-3 font-display text-3xl font-semibold tabular-nums">
                  <CountUp value={value} />
                  {suffix && <span className="ml-1 text-base text-ink-400">{suffix}</span>}
                </div>
              </Card>
            ))}
      </motion.section>

      {firstRun ? (
        <motion.section variants={stagger.item}>
          <Card className="p-6 sm:p-8">
            <SectionTitle icon={<BrainCircuit className="size-5" />}>How it works</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { n: 1, title: 'Choose a topic', text: 'Computer, electrical, mechanical, civil, medical, business… or create your own. Set level, format and timing.', icon: Target },
                { n: 2, title: 'Answer out loud', text: 'The interviewer reads each question. Speak your answer; it is transcribed live.', icon: Mic },
                { n: 3, title: 'Get your debrief', text: 'Scores per dimension, missed points, model answers and delivery stats.', icon: LineChart },
              ].map(({ n, title, text, icon: Icon }) => (
                <motion.div key={n} whileHover={{ y: -4 }} className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-brand to-cyan text-sm font-semibold">{n}</span>
                    <Icon className="size-4 text-ink-400" />
                  </div>
                  <h3 className="font-medium">{title}</h3>
                  <p className="mt-1 text-sm text-ink-400">{text}</p>
                </motion.div>
              ))}
            </div>
          </Card>
        </motion.section>
      ) : (
        <motion.section variants={stagger.item} className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card className="p-5 sm:p-6">
            <SectionTitle icon={<LineChart className="size-5" />} action={<Link to="/history" className="text-sm text-ink-400 hover:text-ink-100">View all</Link>}>
              Score trend
            </SectionTitle>
            {s && s.trend.length > 0 ? (
              <TrendChart points={s.trend} onSelect={(id) => navigate(`/report/${id}`)} />
            ) : (
              <Skeleton className="h-40" />
            )}
          </Card>
          <Card className="p-5 sm:p-6">
            <SectionTitle icon={<Target className="size-5" />}>By topic</SectionTitle>
            <div className="space-y-3.5">
              {s?.byTopic.slice(0, 5).map((t, i) => {
                const tone = scoreTone(t.avg);
                return (
                  <div key={t.topic}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span className="truncate pr-2">{t.topic}</span>
                      <span className="shrink-0 text-ink-400">
                        <span style={{ color: tone.color }} className="font-semibold">
                          {t.avg}
                        </span>{' '}
                        · {t.count}×
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: tone.color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${t.avg}%` }}
                        transition={{ duration: 0.9, delay: 0.3 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </motion.section>
      )}

      <motion.section variants={stagger.item} className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-5 sm:p-6">
          <SectionTitle icon={<Timer className="size-5" />}>Quick start</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {quick.map((t) => (
              <motion.button
                key={`${t.custom ? 'c' : 'p'}:${t.name}`}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.96 }}
                title={t.field}
                onClick={() => navigate(`/setup?${new URLSearchParams({ topic: t.name, field: t.field })}`)}
                className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-ink-200 transition-colors hover:border-white/20 hover:bg-white/[0.06]"
              >
                <t.icon className="size-4" style={{ color: `hsl(${t.hue} 85% 68%)` }} />
                {t.name}
              </motion.button>
            ))}
            <motion.button
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => navigate('/setup')}
              className="flex items-center gap-2 rounded-xl border border-dashed border-brand-soft/40 bg-brand/[0.06] px-3 py-2 text-sm text-brand-soft transition-colors hover:border-brand-soft/80"
            >
              <Plus className="size-4" /> Custom topic
            </motion.button>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <SectionTitle icon={<MessageSquareText className="size-5" />}>Recent sessions</SectionTitle>
          {recent.loading && !recent.data ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : recent.data?.length ? (
            <div className="space-y-2">
              {recent.data.slice(0, 4).map((r) => {
                const Icon = topicMeta(r.config.topic, r.config.field).icon;
                const href = r.status === 'completed' ? `/report/${r.id}` : `/interview/${r.id}`;
                return (
                  <Link key={r.id} to={href} className="group flex items-center gap-3 rounded-xl border border-transparent p-2.5 transition-colors hover:border-white/8 hover:bg-white/[0.03]">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.05]">
                      <Icon className="size-5 text-brand-soft" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.config.topic}</div>
                      <div className="text-xs text-ink-400">
                        {r.config.field ? `${r.config.field} · ` : ''}{LEVEL_LABELS[r.config.level]} · {relativeDate(r.createdAt)}
                      </div>
                    </div>
                    {r.status === 'completed' ? <MiniRing score={r.overallScore} /> : <Badge color="#fbbf24">Resume</Badge>}
                    <ArrowRight className="size-4 text-ink-400 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-ink-400">Your interviews will show up here.</p>
          )}
        </Card>
      </motion.section>
    </motion.div>
  );
}
