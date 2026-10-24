import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  CornerDownRight,
  Flag,
  Keyboard,
  LogOut,
  Mic,
  Play,
  RotateCcw,
  Send,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { computeMetrics } from '../../../shared/metrics.js';
import { TimerRing } from '../components/charts';
import { Badge, Button, Card, Modal, useToast } from '../components/ui';
import { LiveWave, MicButton, Orb, Typewriter, type OrbState } from '../components/visuals';
import { api } from '../lib/api';
import { cx, formatDuration, scoreTone } from '../lib/format';
import { useHotkey, useMediaQuery, useMeta } from '../lib/hooks';
import { useSettings } from '../lib/settings';
import { cancelSpeech, chime, resolveEngine, speak, ttsSupported, useAnswerCapture } from '../lib/speech';
import type { Question, Session } from '../lib/types';

type Phase = 'loading' | 'intro' | 'asking' | 'thinking' | 'answering' | 'evaluating' | 'feedback' | 'finishing';

const ORB_STATE: Record<Phase, OrbState> = {
  loading: 'idle',
  intro: 'idle',
  asking: 'speaking',
  thinking: 'idle',
  answering: 'listening',
  evaluating: 'thinking',
  feedback: 'idle',
  finishing: 'thinking',
};

export function InterviewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [settings, updateSettings] = useSettings();
  const meta = useMeta();
  const compact = useMediaQuery('(max-width: 639px)');

  const [session, setSession] = useState<Session | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [thinkLeft, setThinkLeft] = useState(0);
  const [typed, setTyped] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ question: Question; followUp: Question | null } | null>(null);

  const askToken = useRef(0);
  const spoken = useRef({ seconds: 0, pauses: 0 });

  const current = session?.questions.find((q) => !q.answer) ?? null;
  const engine = resolveEngine(settings.sttEngine, !!meta.data?.whisper);
  const capture = useAnswerCapture({ engine, lang: settings.language, prompt: current?.text ?? '' });
  const voiceMode = !typed && engine !== 'none';

  useEffect(() => {
    api
      .session(id)
      .then((s) => {
        if (s.status === 'completed') navigate(`/report/${id}`, { replace: true });
        else {
          setSession(s);
          setPhase('intro');
        }
      })
      .catch((e: Error) => setLoadError(e.message));
    return () => cancelSpeech();
  }, [id, navigate]);

  useEffect(() => {
    if (meta.data && engine === 'none') setTyped(true);
  }, [engine, meta.data]);

  // ----- flow -----

  const beginAnswer = useCallback(() => {
    cancelSpeech();
    setPhase('answering');
    if (voiceMode) {
      if (settings.sounds) chime('start');
      capture.start();
    }
  }, [voiceMode, settings.sounds, capture]);

  const ask = useCallback(
    async (q: Question, s: Session) => {
      const token = ++askToken.current;
      capture.reset();
      spoken.current = { seconds: 0, pauses: 0 };
      setPhase('asking');
      if (settings.autoRead && ttsSupported) {
        await speak(q.text, { voiceURI: settings.voiceURI, rate: settings.speechRate, lang: settings.language });
      } else {
        await new Promise((r) => setTimeout(r, Math.min(3500, 600 + q.text.length * 18)));
      }
      if (token !== askToken.current) return;
      if (s.config.thinkSeconds > 0) {
        setThinkLeft(s.config.thinkSeconds);
        setPhase('thinking');
      } else beginAnswer();
    },
    [settings.autoRead, settings.voiceURI, settings.speechRate, settings.language, capture, beginAnswer],
  );

  // Think-time countdown, then recording starts on its own.
  useEffect(() => {
    if (phase !== 'thinking') return;
    if (thinkLeft <= 0) {
      beginAnswer();
      return;
    }
    const t = setTimeout(() => setThinkLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, thinkLeft, beginAnswer]);

  /** Stops the mic and returns the final transcript (null if it wasn't recording). */
  const stopRecording = useCallback(async () => {
    if (!capture.recording) return null;
    if (settings.sounds) chime('stop');
    const res = await capture.stop();
    spoken.current.seconds += res.durationSec;
    spoken.current.pauses += res.pauseCount;
    return res.transcript;
  }, [capture, settings.sounds]);

  // Hard stop at the time limit.
  useEffect(() => {
    if (session && capture.recording && capture.elapsed + spoken.current.seconds >= session.config.answerSeconds) {
      stopRecording();
      toast('Time is up for this answer. Review it and submit.');
    }
  }, [capture.elapsed, capture.recording, session, stopRecording, toast]);

  const finish = useCallback(async () => {
    setPhase('finishing');
    setFinishError(null);
    cancelSpeech();
    try {
      await api.finish(id);
      if (settings.sounds) chime('done');
      navigate(`/report/${id}`, { replace: true });
    } catch (e) {
      setFinishError((e as Error).message);
    }
  }, [id, navigate, settings.sounds]);

  const proceed = useCallback(
    (s: Session) => {
      setLastResult(null);
      const next = s.questions.find((q) => !q.answer);
      if (next) ask(next, s);
      else finish();
    },
    [ask, finish],
  );

  const submit = useCallback(
    async (skipped = false) => {
      if (!session || !current) return;
      const transcript = ((await stopRecording()) ?? capture.text).trim();
      if (!skipped && !transcript) {
        toast('Say or type an answer first, or skip this question.', 'error');
        return;
      }
      askToken.current++;
      cancelSpeech();
      setPhase('evaluating');
      try {
        const res = await api.answer(session.id, current.id, {
          transcript: skipped ? '' : transcript,
          durationSec: typed ? 0 : spoken.current.seconds,
          pauseCount: spoken.current.pauses,
          skipped,
          inputMode: typed ? 'typed' : 'voice',
        });
        setSession(res.session);
        if (settings.feedbackAfterEach && !skipped && !res.deferred) {
          setLastResult({ question: res.question, followUp: res.followUp });
          setPhase('feedback');
        } else proceed(res.session);
      } catch (e) {
        toast((e as Error).message, 'error');
        setPhase('answering');
      }
    },
    [session, current, capture, stopRecording, toast, typed, settings.feedbackAfterEach, proceed],
  );

  const toggleRecording = useCallback(() => {
    if (phase === 'thinking') return beginAnswer();
    if (phase !== 'answering' || !voiceMode || capture.status === 'transcribing') return;
    if (capture.recording) stopRecording();
    else {
      if (settings.sounds) chime('start');
      capture.start(capture.text);
    }
  }, [phase, voiceMode, capture, stopRecording, beginAnswer, settings.sounds]);

  useHotkey('Space', toggleRecording, phase === 'answering' || phase === 'thinking');
  useHotkey('Enter', () => phase === 'feedback' && session && proceed(session), phase === 'feedback');

  // ----- derived -----

  const progress = useMemo(() => {
    if (!session) return { main: [], index: 0 };
    const main = session.questions.filter((q) => !q.followUpOf);
    const currentMainId = current?.followUpOf ?? current?.id;
    return { main, index: Math.max(0, main.findIndex((q) => q.id === currentMainId)) };
  }, [session, current]);

  const liveMetrics = useMemo(
    () => computeMetrics(`${capture.text} ${capture.interim}`, spoken.current.seconds + (capture.recording ? capture.elapsed : 0), 0),
    [capture.text, capture.interim, capture.elapsed, capture.recording],
  );

  if (loadError) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center text-center">
        <CircleAlert className="size-10 text-bad" />
        <p className="mt-4 text-lg">{loadError}</p>
        <Button className="mt-6" onClick={() => navigate('/')}>
          Back to dashboard
        </Button>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex min-h-[80dvh] items-center justify-center">
        <Orb state="thinking" size={160} />
      </div>
    );
  }

  const elapsedTotal = spoken.current.seconds + (capture.recording ? capture.elapsed : 0);
  const timeLeft = session.config.answerSeconds - elapsedTotal;
  const timerColor = timeLeft < 15 ? '#fb7185' : timeLeft < 40 ? '#fbbf24' : '#22d3ee';
  const orbState: OrbState = phase === 'answering' && !capture.recording ? 'idle' : ORB_STATE[phase];
  const gradeAtEnd = session?.config.grading === 'end';
  const statusLabel = {
    loading: '',
    intro: 'Ready when you are',
    asking: settings.autoRead ? 'Asking…' : 'New question',
    thinking: `Take a moment to think · ${thinkLeft}s`,
    answering: capture.status === 'transcribing' ? 'Transcribing…' : capture.recording ? 'Listening…' : typed ? 'Type your answer' : 'Paused',
    evaluating: gradeAtEnd ? 'Saving your answer…' : 'Evaluating your answer…',
    feedback: 'Quick feedback',
    finishing: gradeAtEnd ? 'Grading your answers…' : 'Writing your debrief…',
  }[phase];

  return (
    <div className="flex min-h-[calc(100dvh-2rem)] flex-col">
      {/* Top bar */}
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="sm" icon={<X className="size-4" />} onClick={() => setExitOpen(true)} aria-label="Exit interview">
          <span className="hidden sm:inline">Exit</span>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center justify-between text-xs text-ink-400">
            <span className="truncate font-medium text-ink-200">{session.config.topic}</span>
            <span className="shrink-0">
              Question {Math.min(progress.index + 1, progress.main.length)} of {progress.main.length}
            </span>
          </div>
          <div className="flex gap-1">
            {progress.main.map((q, i) => (
              <div key={q.id} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-brand to-cyan"
                  initial={false}
                  animate={{ width: q.answer ? '100%' : i === progress.index ? '45%' : '0%' }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            ))}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={settings.autoRead ? 'Mute interviewer' : 'Unmute interviewer'}
          onClick={() => {
            if (settings.autoRead) cancelSpeech();
            updateSettings({ autoRead: !settings.autoRead });
          }}
          icon={settings.autoRead ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        />
      </div>

      <div className="grid flex-1 items-start gap-4 lg:grid-cols-[1fr_1.15fr] lg:gap-6">
        {/* Interviewer */}
        <Card className="relative flex flex-col items-center overflow-hidden p-4 sm:p-8 lg:sticky lg:top-4 lg:min-h-[560px]">
          <Orb state={orbState} size={compact ? 110 : 200} levelRef={capture.levelRef} />
          <AnimatePresence mode="wait">
            <motion.div key={statusLabel} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="mt-1 text-sm font-medium text-ink-300 sm:mt-2">
              {statusLabel}
            </motion.div>
          </AnimatePresence>

          <div className="mt-3 w-full sm:mt-6">
            <AnimatePresence mode="wait">
              {phase === 'intro' ? (
                <motion.div key="intro" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="text-center">
                  <h1 className="font-display text-2xl font-semibold sm:text-3xl">
                    {session.questions.some((q) => q.answer) ? 'Welcome back' : 'Your interviewer is ready'}
                  </h1>
                  <p className="mx-auto mt-2 max-w-sm text-ink-300">
                    {session.questions.some((q) => q.answer)
                      ? `Pick up where you left off: question ${progress.index + 1} of ${progress.main.length}.`
                      : `${progress.main.length} questions on ${session.config.topic}. Answer out loud as you would in a real interview.`}
                  </p>
                  <Button variant="primary" size="lg" className="mt-6" icon={<Play className="size-5" />} onClick={() => current && ask(current, session)}>
                    {session.questions.some((q) => q.answer) ? 'Resume' : 'Start interview'}
                  </Button>
                </motion.div>
              ) : current || lastResult ? (
                <QuestionCard key={(lastResult?.question ?? current)!.id} question={phase === 'feedback' && lastResult ? lastResult.question : current!} parent={phase === 'feedback' ? undefined : session.questions.find((q) => q.id === current?.followUpOf)} />
              ) : null}
            </AnimatePresence>
          </div>

          {phase === 'asking' && (
            <Button variant="ghost" size="sm" className="mt-4" icon={<SkipForward className="size-4" />} onClick={() => (askToken.current++, session.config.thinkSeconds ? (cancelSpeech(), setThinkLeft(session.config.thinkSeconds), setPhase('thinking')) : beginAnswer())}>
              Skip reading
            </Button>
          )}
          {phase === 'thinking' && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-5 flex items-center gap-4">
              <TimerRing progress={thinkLeft / session.config.thinkSeconds} size={52}>
                {thinkLeft}
              </TimerRing>
              <Button variant="primary" icon={<Mic className="size-4" />} onClick={beginAnswer}>
                Start answering
              </Button>
            </motion.div>
          )}
        </Card>

        {/* Answer panel */}
        <div className="space-y-4">
          <AnimatePresence mode="wait">
            {phase === 'feedback' && lastResult ? (
              <FeedbackCard key="feedback" result={lastResult} onNext={() => proceed(session)} isLast={!session.questions.some((q) => !q.answer)} />
            ) : phase === 'finishing' ? (
              <motion.div key="finishing" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Card className="p-8 text-center">
                  {finishError ? (
                    <>
                      <CircleAlert className="mx-auto size-8 text-bad" />
                      <p className="mt-3">{finishError}</p>
                      <Button variant="primary" className="mt-5" onClick={finish}>
                        Try again
                      </Button>
                    </>
                  ) : (
                    <>
                      <h2 className="font-display text-2xl font-semibold">That's a wrap!</h2>
                      <p className="mt-2 text-ink-300">
                        {gradeAtEnd
                          ? `Grading your ${session.questions.filter((q) => q.answer && !q.answer.skipped).length} answers and writing the debrief. This takes a little longer.`
                          : 'Reviewing all your answers and writing the debrief…'}
                      </p>
                      <div className="mx-auto mt-6 h-1.5 max-w-xs overflow-hidden rounded-full bg-white/[0.06]">
                        <motion.div className="h-full w-1/3 rounded-full bg-gradient-to-r from-brand to-cyan" animate={{ x: ['-100%', '300%'] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} />
                      </div>
                    </>
                  )}
                </Card>
              </motion.div>
            ) : (
              <motion.div key="answer" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
                <Card className={cx('overflow-hidden transition-shadow duration-500', capture.recording && 'shadow-[0_0_0_1px_rgb(34_211_238/0.35),0_20px_60px_-20px_rgb(34_211_238/0.4)]')}>
                  <div className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {capture.recording ? (
                        <span className="relative flex size-2.5">
                          <span className="absolute inline-flex size-full animate-ping rounded-full bg-bad opacity-75" />
                          <span className="relative inline-flex size-2.5 rounded-full bg-bad" />
                        </span>
                      ) : (
                        <span className="size-2.5 rounded-full bg-ink-600" />
                      )}
                      Your answer
                    </div>
                    <div className="flex items-center gap-3">
                      {engine !== 'none' && phase === 'answering' && !capture.recording && (
                        <button onClick={() => setTyped((t) => !t)} className="flex items-center gap-1.5 text-xs text-ink-400 transition-colors hover:text-ink-100">
                          {typed ? <Mic className="size-3.5" /> : <Keyboard className="size-3.5" />}
                          {typed ? 'Speak instead' : 'Type instead'}
                        </button>
                      )}
                      <TimerRing progress={Math.max(0, timeLeft) / session.config.answerSeconds} size={40} color={timerColor}>
                        <span className="text-[10px]">{formatDuration(Math.max(0, timeLeft))}</span>
                      </TimerRing>
                    </div>
                  </div>

                  <TranscriptArea
                    phase={phase}
                    recording={capture.recording}
                    transcribing={capture.status === 'transcribing'}
                    typed={typed}
                    text={capture.text}
                    interim={capture.interim}
                    onChange={capture.setText}
                    onSubmit={() => submit(false)}
                  />

                  {voiceMode && phase === 'answering' && <LiveWave levelRef={capture.levelRef} active={capture.recording} className="px-5" />}

                  <AnimatePresence>
                    {capture.error && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="mx-5 mb-3 flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
                          <CircleAlert className="mt-0.5 size-4 shrink-0" />
                          <span className="flex-1">{capture.error}</span>
                          <button onClick={capture.clearError} aria-label="Dismiss">
                            <X className="size-4" />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Controls */}
                  <div className="flex flex-col items-center gap-2 border-t border-white/5 px-4 pt-2 pb-4 sm:flex-row sm:justify-between sm:px-5">
                    <div className="order-2 flex w-full justify-between gap-2 sm:order-1 sm:w-auto sm:justify-start">
                      <Button size="sm" variant="ghost" icon={<SkipForward className="size-4" />} disabled={phase !== 'answering' && phase !== 'thinking'} onClick={() => submit(true)}>
                        Skip
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<RotateCcw className="size-4" />}
                        disabled={phase !== 'answering' || (!capture.text && !capture.recording)}
                        onClick={() => {
                          capture.reset();
                          spoken.current = { seconds: 0, pauses: 0 };
                          if (voiceMode) capture.start();
                        }}
                      >
                        Redo
                      </Button>
                    </div>
                    {voiceMode && (
                      <div className="order-1 -my-4 sm:order-2">
                        <MicButton recording={capture.recording} levelRef={capture.levelRef} onClick={toggleRecording} disabled={(phase !== 'answering' && phase !== 'thinking') || capture.status === 'transcribing'} size={72} />
                      </div>
                    )}
                    <div className="order-3 w-full sm:w-auto">
                      <Button
                        variant="primary"
                        className="w-full sm:w-auto"
                        icon={<Send className="size-4" />}
                        loading={phase === 'evaluating' || capture.status === 'transcribing'}
                        disabled={phase !== 'answering' || (!capture.text.trim() && !capture.recording)}
                        onClick={() => submit(false)}
                      >
                        {phase === 'evaluating' ? (gradeAtEnd ? 'Saving' : 'Evaluating') : 'Submit answer'}
                      </Button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Live stats */}
          {phase !== 'feedback' && phase !== 'finishing' && (
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Spoken', value: formatDuration(elapsedTotal) },
                { label: 'Words', value: liveMetrics.wordCount },
                { label: 'Pace', value: typed ? '–' : liveMetrics.wpm ? `${liveMetrics.wpm}` : '–', hint: 'wpm', warn: !typed && liveMetrics.wordCount > 20 && (liveMetrics.wpm > 175 || liveMetrics.wpm < 100) },
                { label: 'Fillers', value: liveMetrics.fillerCount, warn: liveMetrics.fillerRate > 4 },
              ].map((m) => (
                <div key={m.label} className="glass rounded-xl px-3 py-2.5 text-center">
                  <div className={cx('font-display text-lg font-semibold tabular-nums transition-colors', m.warn ? 'text-warn' : 'text-ink-100')}>
                    {m.value}
                    {m.hint && m.value !== '–' && <span className="ml-0.5 text-[10px] font-normal text-ink-400">{m.hint}</span>}
                  </div>
                  <div className="text-[11px] text-ink-400">{m.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal open={exitOpen} onClose={() => setExitOpen(false)} title="Leave the interview?">
        <p className="text-sm text-ink-300">Your answers so far are saved. You can finish now and get a report on what you answered, or come back later.</p>
        <div className="mt-6 flex flex-col gap-2">
          <Button
            variant="primary"
            icon={<Flag className="size-4" />}
            disabled={!session.questions.some((q) => q.answer && !q.answer.skipped)}
            onClick={() => {
              setExitOpen(false);
              capture.reset();
              finish();
            }}
          >
            Finish now and get report
          </Button>
          <Button
            icon={<LogOut className="size-4" />}
            onClick={() => {
              cancelSpeech();
              capture.reset();
              navigate('/');
            }}
          >
            Save and leave
          </Button>
          <Button variant="ghost" onClick={() => setExitOpen(false)}>
            Keep going
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function QuestionCard({ question, parent }: { question: Question; parent?: Question }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.3 }}>
      <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
        {question.followUpOf && (
          <Badge color="#7dd3fc">
            <CornerDownRight className="size-3" /> Follow-up
          </Badge>
        )}
        <Badge>{question.focus}</Badge>
        <Badge color={{ easy: '#34d399', medium: '#fbbf24', hard: '#fb7185' }[question.difficulty]}>{question.difficulty}</Badge>
      </div>
      {parent && <p className="mx-auto mb-2 max-w-md truncate text-center text-xs text-ink-400">Following up on: {parent.text}</p>}
      <Typewriter text={question.text} className="text-center font-display text-lg leading-snug font-medium sm:text-2xl" />
    </motion.div>
  );
}

function TranscriptArea({
  phase,
  recording,
  transcribing,
  typed,
  text,
  interim,
  onChange,
  onSubmit,
}: {
  phase: Phase;
  recording: boolean;
  transcribing: boolean;
  typed: boolean;
  text: string;
  interim: string;
  onChange: (t: string) => void;
  onSubmit: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [text, interim]);

  if (recording || transcribing) {
    return (
      <div ref={scrollRef} className="h-40 overflow-y-auto px-5 py-4 text-[15px] leading-relaxed sm:h-64">
        {text || interim ? (
          <p>
            {text} <span className="text-ink-400 italic">{interim}</span>
            <motion.span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-cyan" animate={{ opacity: [1, 0] }} transition={{ duration: 0.8, repeat: Infinity }} />
          </p>
        ) : (
          <p className="text-ink-400">{transcribing ? 'Transcribing your answer…' : 'Start speaking. Your words will appear here.'}</p>
        )}
      </div>
    );
  }
  return (
    <textarea
      value={text}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onSubmit();
        }
      }}
      disabled={phase !== 'answering'}
      placeholder={
        phase === 'answering'
          ? typed
            ? 'Type your answer here…'
            : 'Tap the mic to answer. You can also edit the transcript here before submitting.'
          : 'Waiting for the question…'
      }
      className="block h-40 w-full resize-none bg-transparent px-5 py-4 text-[15px] leading-relaxed outline-none placeholder:text-ink-400 disabled:opacity-60 sm:h-64"
    />
  );
}

function FeedbackCard({ result, onNext, isLast }: { result: { question: Question; followUp: Question | null }; onNext: () => void; isLast: boolean }) {
  const ev = result.question.evaluation!;
  const score = Math.round(ev.overall * 10);
  const tone = scoreTone(score);
  return (
    <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12 }} transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
      <Card className="overflow-hidden p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }}
            className="flex size-16 shrink-0 items-center justify-center rounded-2xl font-display text-2xl font-semibold"
            style={{ background: `${tone.color}1f`, color: tone.color, boxShadow: `0 0 40px -10px ${tone.color}` }}
          >
            {ev.overall.toFixed(1)}
          </motion.div>
          <div>
            <div className="text-xs tracking-wide text-ink-400 uppercase">Answer score</div>
            <div className="font-display text-xl font-semibold capitalize" style={{ color: tone.color }}>
              {ev.verdict}
            </div>
          </div>
        </div>
        <p className="mt-4 text-ink-200">{ev.summary}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {ev.strengths[0] && (
            <div className="rounded-xl border border-good/20 bg-good/5 p-3 text-sm">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-good">
                <CheckCircle2 className="size-3.5" /> Worked well
              </div>
              {ev.strengths[0]}
            </div>
          )}
          {ev.improvements[0] && (
            <div className="rounded-xl border border-warn/20 bg-warn/5 p-3 text-sm">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-warn">
                <ArrowRight className="size-3.5" /> Improve
              </div>
              {ev.improvements[0]}
            </div>
          )}
        </div>
        {result.followUp && (
          <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="mt-4 flex items-center gap-2 rounded-xl border border-accent/25 bg-accent/5 p-3 text-sm text-accent">
            <CornerDownRight className="size-4 shrink-0" /> The interviewer has a follow-up question.
          </motion.div>
        )}
        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="hidden text-xs text-ink-400 sm:inline">Full breakdown in the final report · Enter to continue</span>
          <Button variant="primary" className="w-full sm:w-auto" onClick={onNext} icon={isLast ? <Flag className="size-4" /> : <ArrowRight className="size-4" />}>
            {isLast ? 'Finish interview' : result.followUp ? 'Answer follow-up' : 'Next question'}
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}
