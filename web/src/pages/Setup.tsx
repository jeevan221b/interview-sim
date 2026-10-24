import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  ChevronDown,
  CircleAlert,
  Clock,
  FileText,
  Mic,
  MicOff,
  PenLine,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Repeat2,
  Rocket,
  Search,
  Volume2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, Chip, Modal, Segmented, Slider, Toggle, useToast } from '../components/ui';
import { QuotaSummary, estimateCalls } from '../components/quota';
import { Orb } from '../components/visuals';
import { api } from '../lib/api';
import { LEVEL_LABELS, cx, roleLabel } from '../lib/format';
import { refreshMe, useMeta } from '../lib/hooks';
import { useSettings } from '../lib/settings';
import { browserSttSupported, micSupported, resolveEngine, speak, ttsSupported, useMicTest } from '../lib/speech';
import { ALL_ROLES, FIELDS, TOPICS, customToTopic, fieldMeta, useCustomTopics, type CustomTopic, type Topic } from '../lib/topics';
import type { InterviewType, Level, SessionConfig } from '../lib/types';

const STEPS = ['Topic', 'Format', 'Ready'];
const LEVELS: Level[] = ['intern', 'junior', 'mid', 'senior', 'lead'];
const PREP_MESSAGES = ['Reading up on your topic…', 'Drafting questions…', 'Calibrating difficulty…', 'Warming up the interviewer…'];

export function SetupPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(params.get('topic') ? 1 : 0);
  const [dir, setDir] = useState(1);
  const [creating, setCreating] = useState(false);

  const initialTopic = params.get('topic') || '';
  const { list: customList } = useCustomTopics();
  const preset = TOPICS.find((t) => t.name === initialTopic) ?? customList.map(customToTopic).find((t) => t.name === initialTopic);
  const initialField = params.get('field') || preset?.field || '';
  // Role follows the chosen field until the user edits it themselves.
  const [roleTouched, setRoleTouched] = useState(params.has('role'));
  const [config, setConfig] = useState<SessionConfig>({
    topic: initialTopic,
    field: initialField,
    focus: params.get('focus') || preset?.focus || '',
    role: params.get('role') ?? fieldMeta(initialField)?.defaultRole ?? '',
    level: (params.get('level') as Level) || 'junior',
    type: (params.get('type') as InterviewType) || preset?.type || 'technical',
    questionCount: 6,
    answerSeconds: 150,
    thinkSeconds: 10,
    followUps: true,
    context: '',
    grading: 'each',
    modelAnswers: 'brief',
  });
  const set = (patch: Partial<SessionConfig>) => setConfig((c) => ({ ...c, ...patch }));

  const pickTopic = (t: Pick<Topic, 'name' | 'field' | 'focus' | 'type'>) => {
    const f = fieldMeta(t.field);
    set({
      topic: t.name,
      field: t.field,
      focus: t.focus ?? '',
      ...(t.type ? { type: t.type } : {}),
      ...(!roleTouched && f?.defaultRole ? { role: f.defaultRole } : {}),
    });
    go(1);
  };

  const go = (next: number) => {
    setDir(next > step ? 1 : -1);
    setStep(next);
  };

  const create = async () => {
    setCreating(true);
    try {
      const session = await api.createSession(config);
      refreshMe();
      navigate(`/interview/${session.id}`);
    } catch (e) {
      toast((e as Error).message, 'error');
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      {/* Stepper */}
      <div className="mb-8 flex items-center justify-center gap-2 sm:gap-3">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => (i < step || config.topic) && go(i)}
              className={cx('flex items-center gap-2 rounded-full px-1 text-sm font-medium transition-colors', i <= step ? 'text-ink-100' : 'text-ink-400')}
            >
              <motion.span
                animate={{
                  background: i < step ? 'linear-gradient(135deg,#3b82f6,#22d3ee)' : i === step ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.05)',
                  scale: i === step ? 1.1 : 1,
                }}
                className={cx('flex size-8 items-center justify-center rounded-full text-sm ring-1', i === step ? 'ring-brand-soft/60' : 'ring-white/10')}
              >
                {i < step ? <Check className="size-4" /> : i + 1}
              </motion.span>
              <span className="hidden sm:inline">{label}</span>
            </button>
            {i < STEPS.length - 1 && (
              <div className="h-px w-8 overflow-hidden bg-white/10 sm:w-16">
                <motion.div className="h-full bg-gradient-to-r from-brand to-cyan" animate={{ width: i < step ? '100%' : '0%' }} transition={{ duration: 0.4 }} />
              </div>
            )}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait" custom={dir}>
        <motion.div
          key={step}
          custom={dir}
          initial={{ opacity: 0, x: dir * 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -40 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          {step === 0 && <TopicStep value={config.topic} onPick={pickTopic} />}
          {step === 1 && <FormatStep config={config} set={set} onRoleEdit={() => setRoleTouched(true)} />}
          {step === 2 && <ReadyStep config={config} />}
        </motion.div>
      </AnimatePresence>

      {/* Footer nav */}
      <div className="glass sticky bottom-24 z-20 mt-8 flex items-center justify-between gap-3 rounded-2xl bg-ink-900/80 p-2 md:bottom-4">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => (step === 0 ? navigate('/') : go(step - 1))}>
          Back
        </Button>
        {step < 2 ? (
          <Button variant="primary" disabled={!config.topic.trim()} onClick={() => go(step + 1)}>
            Continue <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button variant="primary" size="lg" icon={<Rocket className="size-5" />} onClick={create} loading={creating}>
            Begin interview
          </Button>
        )}
      </div>

      <PreparingOverlay open={creating} topic={config.topic} />
    </div>
  );
}

type FieldFilter = 'All' | 'Mine' | string;

function TopicStep({ value, onPick }: { value: string; onPick: (t: Topic) => void }) {
  const [query, setQuery] = useState('');
  const [field, setField] = useState<FieldFilter>('All');
  const [builder, setBuilder] = useState<Partial<CustomTopic> | null>(null);
  const { list: customList, save, remove } = useCustomTopics();
  const toast = useToast();
  const custom = useMemo(() => customList.map(customToTopic), [customList]);
  const q = query.trim().toLowerCase();
  const matches = (t: Topic) => !q || t.name.toLowerCase().includes(q) || t.field.toLowerCase().includes(q);
  const filtered = useMemo(
    () =>
      [...custom, ...TOPICS].filter(
        (t) => matches(t) && (field === 'All' || (field === 'Mine' ? t.custom : !t.custom && t.field === field)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [custom, q, field],
  );
  const exact = [...custom, ...TOPICS].find((t) => t.name.toLowerCase() === q);
  const openBuilder = (name = query.trim()) =>
    setBuilder({ name, field: field !== 'All' && field !== 'Mine' ? field : '', focus: '' });

  return (
    <div>
      <h1 className="text-center font-display text-3xl font-semibold tracking-tight sm:text-4xl">
        What are we <span className="gradient-text">interviewing</span> for?
      </h1>
      <p className="mx-auto mt-2 max-w-xl text-center text-ink-300">
        Computer science, electrical, mechanical, civil, medical, business… pick a field and topic, or create your own.
      </p>

      <form
        className="relative mx-auto mt-6 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (exact) onPick(exact);
          else if (q) openBuilder();
        }}
      >
        <Search className="absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-400" />
        <input autoFocus className={cx('field h-14 pl-12 text-base', q && !exact && 'pr-36')} placeholder="Search topics or type your own…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <AnimatePresence>
          {q && !exact && (
            <motion.button
              type="submit"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1.5 rounded-lg bg-brand/80 px-3 py-1.5 text-sm font-medium text-white"
            >
              <Plus className="size-4" /> Custom topic
            </motion.button>
          )}
        </AnimatePresence>
      </form>

      <div className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0">
        <Chip active={field === 'All'} onClick={() => setField('All')}>
          All
        </Chip>
        {custom.length > 0 && (
          <Chip active={field === 'Mine'} onClick={() => setField('Mine')}>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <Sparkles className="size-3.5 text-brand-soft" /> My topics
            </span>
          </Chip>
        )}
        {FIELDS.map((f) => (
          <Chip key={f.name} active={field === f.name} onClick={() => setField(f.name)}>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <f.icon className="size-3.5" style={{ color: `hsl(${f.hue} 85% 68%)` }} /> {f.short}
            </span>
          </Chip>
        ))}
      </div>

      <motion.div layout className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <motion.button
          layout
          key="__create"
          whileHover={{ y: -4 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => openBuilder()}
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-dashed border-brand-soft/40 bg-brand/[0.06] p-4 text-left transition-colors hover:border-brand-soft/80 hover:bg-brand/[0.12]"
        >
          <span className="absolute -top-10 -right-10 size-28 rounded-full bg-gradient-to-br from-brand to-cyan opacity-20 blur-2xl transition-opacity duration-500 group-hover:opacity-50" />
          <span className="relative mb-3 flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-cyan shadow-[0_0_24px_-6px_rgb(59_130_246/0.9)]">
            <motion.span className="flex" whileHover={{ rotate: 90 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}>
              <Plus className="size-5 text-white" />
            </motion.span>
          </span>
          <span className="relative">
            <span className="block text-sm leading-snug font-medium">Create your own</span>
            <span className="mt-1 block text-xs text-ink-400">Any field, any topic</span>
          </span>
        </motion.button>

        <AnimatePresence mode="popLayout">
          {filtered.map((t) => {
            const active = value === t.name;
            return (
              <motion.div
                layout
                key={`${t.custom ? 'c' : 'p'}:${t.name}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.97 }}
                className="relative"
              >
                <button
                  onClick={() => onPick(t)}
                  className={cx(
                    'glass group relative h-full w-full overflow-hidden rounded-2xl p-4 text-left transition-shadow',
                    active && 'ring-2 ring-brand-soft/70 shadow-[0_0_30px_-8px_rgb(59_130_246/0.8)]',
                  )}
                >
                  <span
                    className="absolute -top-8 -right-8 size-24 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-60"
                    style={{ background: `hsl(${t.hue} 85% 60%)` }}
                  />
                  <span className="relative mb-3 flex size-10 items-center justify-center rounded-xl" style={{ background: `hsl(${t.hue} 85% 60% / 0.12)` }}>
                    <t.icon className="size-5" style={{ color: `hsl(${t.hue} 85% 70%)` }} />
                  </span>
                  <span className="relative block pr-5 text-sm leading-snug font-medium">{t.name}</span>
                  <span className="relative mt-1 flex items-center gap-1 text-xs text-ink-400">
                    {t.custom && <Sparkles className="size-3 text-brand-soft" />}
                    <span className="truncate">{t.custom ? t.field || 'Custom' : t.field}</span>
                  </span>
                </button>
                {t.custom && (
                  <button
                    aria-label={`Remove ${t.name}`}
                    onClick={() => {
                      remove(t.name).then(
                        () => toast(`Removed “${t.name}”`),
                        (e: Error) => toast(e.message, 'error'),
                      );
                    }}
                    className="absolute top-2 right-2 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-bad/15 hover:text-bad"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
      {filtered.length === 0 && (
        <p className="mt-8 text-center text-ink-400">
          No preset matches.{' '}
          <button className="text-brand-soft underline-offset-4 hover:underline" onClick={() => openBuilder()}>
            Create “{query.trim()}” as a custom topic
          </button>
        </p>
      )}

      <CustomTopicModal
        draft={builder}
        onClose={() => setBuilder(null)}
        onSave={(c) => {
          save(c).catch((e: Error) => toast(`Couldn't save the topic: ${e.message}`, 'error'));
          setBuilder(null);
          onPick(customToTopic(c));
        }}
      />
    </div>
  );
}

const FOCUS_EXAMPLES: Record<string, string> = {
  'Computer & IT': 'e.g. closures, event loop, promises',
  'Electrical & Electronics': 'e.g. transformer losses, protection relays, earthing',
  Mechanical: 'e.g. IC engine cycles, gear design, welding defects',
  Civil: 'e.g. beam design, soil testing, concrete mix design',
  'Medical & Healthcare': 'e.g. diabetes management, ECG reading, drug interactions',
  'Business & Management': 'e.g. ratio analysis, pricing strategy, case studies',
  'Soft skills': 'e.g. conflict handling, salary negotiation',
};

function CustomTopicModal({ draft, onClose, onSave }: { draft: Partial<CustomTopic> | null; onClose: () => void; onSave: (c: CustomTopic) => void }) {
  const [name, setName] = useState('');
  const [field, setField] = useState('');
  const [otherField, setOtherField] = useState('');
  const [focus, setFocus] = useState('');
  const [type, setType] = useState<InterviewType>('technical');

  useEffect(() => {
    if (!draft) return;
    const known = !draft.field || fieldMeta(draft.field);
    setName(draft.name ?? '');
    setField(known ? (draft.field ?? '') : 'Other');
    setOtherField(known ? '' : (draft.field ?? ''));
    setFocus(draft.focus ?? '');
    setType(draft.field === 'Soft skills' ? 'behavioral' : 'technical');
  }, [draft]);

  const finalField = field === 'Other' ? otherField.trim() : field;
  const valid = name.trim().length > 1 && !!finalField;

  return (
    <Modal open={!!draft} onClose={onClose} title="Create a custom topic" className="max-w-lg">
      <p className="mb-5 text-sm text-ink-400">Saved on this device so you can reuse it. The AI tailors questions to the field and focus areas.</p>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave({ name: name.trim(), field: finalField, focus: focus.trim(), type });
        }}
      >
        <div>
          <label htmlFor="ct-name" className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-200">
            <PenLine className="size-4 text-brand-soft" /> Topic
          </label>
          <input id="ct-name" autoFocus className="field" maxLength={100} placeholder="e.g. Transformers, Cardiology, Hydraulics, Tally ERP…" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-ink-200">Field</label>
          <div className="flex flex-wrap gap-2">
            {[...FIELDS.map((f) => ({ name: f.name, label: f.short, icon: f.icon, hue: f.hue })), { name: 'Other', label: 'Other', icon: Sparkles, hue: 280 }].map((f) => (
              <Chip key={f.name} active={field === f.name} onClick={() => setField(f.name)}>
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <f.icon className="size-3.5" style={{ color: `hsl(${f.hue} 85% 68%)` }} /> {f.label}
                </span>
              </Chip>
            ))}
          </div>
          <AnimatePresence initial={false}>
            {field === 'Other' && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <input className="field mt-3" maxLength={60} autoFocus placeholder="e.g. Law, Architecture, Agriculture, Pharmacy…" value={otherField} onChange={(e) => setOtherField(e.target.value)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div>
          <label htmlFor="ct-focus" className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-200">
            <Target className="size-4 text-brand-soft" /> Focus areas <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <textarea
            id="ct-focus"
            className="field min-h-20 resize-y text-sm"
            maxLength={400}
            placeholder={FOCUS_EXAMPLES[field] ?? 'Sub-topics, chapters or skills to concentrate on'}
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-ink-200">Default interview type</label>
          <Segmented
            id="ct-type"
            value={type}
            onChange={setType}
            options={[
              { value: 'technical', label: 'Technical' },
              { value: 'behavioral', label: 'Behavioral' },
              { value: 'mixed', label: 'Mixed' },
            ]}
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            Save & continue <ArrowRight className="size-4" />
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function FormatStep({ config, set, onRoleEdit }: { config: SessionConfig; set: (p: Partial<SessionConfig>) => void; onRoleEdit: () => void }) {
  const f = fieldMeta(config.field);
  const roles = [...new Set([...(f?.roles ?? []), ...ALL_ROLES])];
  const [showContext, setShowContext] = useState(!!config.context);
  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {config.field && (
            <Badge color={f ? `hsl(${f.hue} 85% 68%)` : '#60a5fa'}>
              {f ? <f.icon className="size-3" /> : <Sparkles className="size-3" />} {config.field}
            </Badge>
          )}
          <Badge color="#22d3ee">{config.topic}</Badge>
        </div>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Shape the interview</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-5 p-5 sm:p-6">
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-200">
              <Briefcase className="size-4 text-brand-soft" /> Role
            </label>
            <input
              className="field"
              list="roles"
              maxLength={80}
              placeholder={f?.defaultRole ? `e.g. ${f.defaultRole}` : 'e.g. Electrical Engineer, Nurse, Analyst'}
              value={config.role}
              onChange={(e) => (onRoleEdit(), set({ role: e.target.value }))}
            />
            <datalist id="roles">
              {roles.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="focus" className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-200">
              <Target className="size-4 text-brand-soft" /> Focus areas <span className="font-normal text-ink-400">(optional)</span>
            </label>
            <input
              id="focus"
              className="field"
              maxLength={400}
              placeholder={FOCUS_EXAMPLES[config.field ?? ''] ?? 'Sub-topics to concentrate on'}
              value={config.focus ?? ''}
              onChange={(e) => set({ focus: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-ink-200">Seniority</label>
            <Segmented id="level" value={config.level} onChange={(level) => set({ level })} options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABELS[l] }))} className="[&_button]:px-1 [&_button]:text-xs sm:[&_button]:text-sm" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-ink-200">Interview type</label>
            <Segmented
              id="type"
              value={config.type}
              onChange={(type) => set({ type })}
              options={[
                { value: 'technical', label: 'Technical' },
                { value: 'behavioral', label: 'Behavioral' },
                { value: 'mixed', label: 'Mixed' },
              ]}
            />
          </div>
        </Card>

        <Card className="space-y-5 p-5 sm:p-6">
          <div>
            <div className="mb-3 flex items-center justify-between text-sm font-medium text-ink-200">
              <span>Questions</span>
              <motion.span key={config.questionCount} initial={{ scale: 1.4, color: '#22d3ee' }} animate={{ scale: 1, color: '#e5ecf7' }} className="font-display text-xl tabular-nums">
                {config.questionCount}
              </motion.span>
            </div>
            <Slider ariaLabel="Number of questions" min={3} max={12} value={config.questionCount} onChange={(questionCount) => set({ questionCount })} />
            <p className="mt-2 text-xs text-ink-400">≈ {Math.round((config.questionCount * (config.answerSeconds * 0.7 + 40)) / 60)} min{config.followUps && config.grading !== 'end' ? ' including follow-ups' : ''}</p>
          </div>
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-200">
              <Clock className="size-4 text-brand-soft" /> Time per answer
            </label>
            <div className="flex flex-wrap gap-2">
              {[60, 120, 150, 180, 300].map((s) => (
                <Chip key={s} active={config.answerSeconds === s} onClick={() => set({ answerSeconds: s })}>
                  {s < 120 ? `${s}s` : `${s / 60}m`}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-ink-200">Thinking time before answering</label>
            <div className="flex flex-wrap gap-2">
              {[0, 5, 10, 20, 30].map((s) => (
                <Chip key={s} active={config.thinkSeconds === s} onClick={() => set({ thinkSeconds: s })}>
                  {s === 0 ? 'None' : `${s}s`}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-2 flex items-center justify-between gap-2 text-sm font-medium text-ink-200">
              <span>Grading</span>
              <span className="text-xs font-normal text-ink-400">≈ {estimateCalls(config.questionCount, config.grading, config.followUps)} AI requests</span>
            </label>
            <Segmented
              id="grading"
              value={config.grading ?? 'each'}
              onChange={(grading) => set({ grading })}
              options={[
                { value: 'each', label: 'After each answer' },
                { value: 'end', label: 'At the end' },
              ]}
            />
            <p className="mt-2 text-xs text-ink-400">
              {config.grading === 'end'
                ? 'Answers are graded together when you finish: far fewer AI requests, but no instant feedback or follow-ups.'
                : 'Instant feedback after every answer, and the interviewer can ask follow-ups.'}
            </p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-ink-200">Model answers</label>
            <Segmented
              id="modelAnswers"
              value={config.modelAnswers ?? 'brief'}
              onChange={(modelAnswers) => set({ modelAnswers })}
              options={[
                { value: 'brief', label: 'Brief' },
                { value: 'full', label: 'Detailed' },
                { value: 'off', label: 'On request' },
              ]}
            />
            <p className="mt-2 text-xs text-ink-400">
              {config.modelAnswers === 'off'
                ? 'Skipped during grading to save tokens; tap “Show model answer” in the report for the ones you want.'
                : config.modelAnswers === 'full'
                  ? 'A full 80–160 word example answer for every question (uses the most tokens).'
                  : 'A short 40–70 word example answer for every question.'}
            </p>
          </div>
          <Toggle
            checked={config.followUps && config.grading !== 'end'}
            disabled={config.grading === 'end'}
            onChange={(followUps) => set({ followUps })}
            label="Adaptive follow-ups"
            description={config.grading === 'end' ? 'Needs grading after each answer.' : 'The interviewer may dig deeper into your answers, like a real one would.'}
          />
        </Card>
      </div>

      <Card className="overflow-hidden">
        <button onClick={() => setShowContext((v) => !v)} className="flex w-full items-center justify-between p-5 text-left sm:px-6">
          <span className="flex items-center gap-3">
            <FileText className="size-5 text-brand-soft" />
            <span>
              <span className="block font-medium">Tailor to a job description or your CV</span>
              <span className="block text-xs text-ink-400">Optional. Paste text and questions will be tailored to it.</span>
            </span>
          </span>
          <motion.span animate={{ rotate: showContext ? 180 : 0 }}>
            <ChevronDown className="size-5 text-ink-400" />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {showContext && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="px-5 pb-5 sm:px-6">
                <textarea
                  className="field min-h-36 resize-y text-sm"
                  maxLength={6000}
                  placeholder="Paste the job description, required skills, or a summary of your experience…"
                  value={config.context}
                  onChange={(e) => set({ context: e.target.value })}
                />
                <div className="mt-1 text-right text-xs text-ink-400">{config.context.length} / 6000</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}

function ReadyStep({ config }: { config: SessionConfig }) {
  const meta = useMeta();
  const [settings] = useSettings();
  const mic = useMicTest();
  const barRef = useRef<HTMLDivElement>(null);
  const [heard, setHeard] = useState(false);
  const engine = resolveEngine(settings.sttEngine, !!meta.data?.whisper);
  const mockOnly = meta.data?.mockOnly;

  useEffect(() => {
    if (!mic.active) return;
    let raf = 0;
    const tick = () => {
      if (barRef.current) barRef.current.style.width = `${Math.min(100, mic.levelRef.current * 140)}%`;
      if (mic.peakRef.current > 0.25) setHeard(true);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [mic.active, mic.levelRef, mic.peakRef]);

  const checks = [
    { ok: micSupported, label: 'Microphone access', detail: micSupported ? 'Available' : 'Not available in this browser' },
    {
      ok: engine !== 'none',
      label: 'Speech to text',
      detail: engine === 'browser' ? 'Browser speech recognition (live captions)' : engine === 'whisper' ? 'Whisper via Groq (after each answer)' : 'Not supported here, so you can type answers instead',
    },
    { ok: ttsSupported, label: 'Interviewer voice', detail: ttsSupported ? (settings.autoRead ? 'Questions will be read aloud' : 'Muted in settings') : 'Not supported, so questions are shown as text' },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.1fr]">
      <Card className="p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold">Your interview</h2>
        <dl className="mt-4 space-y-3 text-sm">
          {[
            ['Field', config.field || 'Not set'],
            ['Topic', config.topic],
            ...(config.focus ? [['Focus', config.focus]] : []),
            ['Role', roleLabel(config.level, config.role)],
            ['Format', `${config.questionCount} ${config.type} questions${config.followUps && config.grading !== 'end' ? ' + follow-ups' : ''}`],
            ['Grading', `${config.grading === 'end' ? 'At the end' : 'After each answer'} · model answers ${config.modelAnswers === 'off' ? 'on request' : config.modelAnswers === 'full' ? 'detailed' : 'brief'}`],
            ['Timing', `${config.thinkSeconds ? `${config.thinkSeconds}s to think, ` : ''}${config.answerSeconds / 60} min per answer`],
            ['Tailored', config.context ? 'Yes, to your job description/CV' : 'No'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-white/5 pb-3 last:border-0">
              <dt className="text-ink-400">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <QuotaSummary needed={estimateCalls(config.questionCount, config.grading, config.followUps)} />
        {mockOnly && (
          <div className="mt-4 flex gap-2 rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
            <CircleAlert className="size-4 shrink-0" />
            The offline mock interviewer is active. Set GROQ_API_KEY and LLM_PROVIDERS=groq in .env for real questions and feedback.
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold">System check</h2>
        <ul className="mt-4 space-y-3">
          {checks.map((c, i) => (
            <motion.li key={c.label} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.1 }} className="flex items-start gap-3">
              <span className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', c.ok ? 'bg-good/20 text-good' : 'bg-warn/20 text-warn')}>
                {c.ok ? <Check className="size-3.5" /> : <CircleAlert className="size-3.5" />}
              </span>
              <span>
                <span className="block text-sm font-medium">{c.label}</span>
                <span className="block text-xs text-ink-400">{c.detail}</span>
              </span>
            </motion.li>
          ))}
        </ul>

        <div className="mt-5 rounded-xl border border-white/8 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Test your microphone</span>
            <div className="flex gap-2">
              {ttsSupported && (
                <Button size="sm" variant="ghost" icon={<Volume2 className="size-4" />} onClick={() => speak(`Hi! Let's talk about ${config.topic}.`, { voiceURI: settings.voiceURI, rate: settings.speechRate, lang: settings.language })}>
                  Voice
                </Button>
              )}
              <Button size="sm" icon={mic.active ? <MicOff className="size-4" /> : <Mic className="size-4" />} onClick={mic.active ? mic.stop : mic.start}>
                {mic.active ? 'Stop' : 'Test'}
              </Button>
            </div>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div ref={barRef} className="h-full w-0 rounded-full bg-gradient-to-r from-good via-cyan to-brand transition-[width] duration-75" />
          </div>
          <p className="mt-2 text-xs text-ink-400">
            {mic.error ? <span className="text-bad">{mic.error}</span> : heard ? <span className="text-good">Sounds good, we can hear you.</span> : mic.active ? 'Say something…' : 'Click Test and say a few words.'}
          </p>
        </div>
        {!browserSttSupported && !meta.data?.whisper && (
          <p className="mt-3 flex items-center gap-2 text-xs text-ink-400">
            <PenLine className="size-3.5" /> Live speech recognition works best in Chrome or Edge.
          </p>
        )}
        <p className="mt-3 flex items-center gap-2 text-xs text-ink-400">
          <Repeat2 className="size-3.5" /> Shortcuts: Space to start/stop recording, Ctrl+Enter to submit.
        </p>
      </Card>
    </div>
  );
}

function PreparingOverlay({ open, topic }: { open: boolean; topic: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!open) return setI(0);
    const t = setInterval(() => setI((n) => (n + 1) % PREP_MESSAGES.length), 1800);
    return () => clearInterval(t);
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink-950/85 px-6 backdrop-blur-xl">
          <Orb state="thinking" size={200} />
          <h2 className="mt-6 text-center font-display text-2xl font-semibold">Preparing your {topic} interview</h2>
          <AnimatePresence mode="wait">
            <motion.p key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mt-2 text-ink-300">
              {PREP_MESSAGES[i]}
            </motion.p>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
