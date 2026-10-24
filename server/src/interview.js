import { randomUUID } from 'node:crypto';
import { computeMetrics } from '../../shared/metrics.js';
import { normalizeEvaluation } from './llm/normalize.js';
import { DIMENSIONS } from './llm/prompts.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const LEVELS = ['intern', 'junior', 'mid', 'senior', 'lead'];
const TYPES = ['technical', 'behavioral', 'mixed'];

const GRADING = ['each', 'end'];
const MODEL_ANSWERS = ['brief', 'full', 'off'];
const BATCH_SIZE = 3;

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function parseConfig(body = {}) {
  const topic = text(body.topic, 100);
  if (!topic) throw new HttpError(400, 'topic is required');
  return {
    topic,
    field: text(body.field, 60),
    focus: text(body.focus, 400),
    role: text(body.role, 80),
    level: LEVELS.includes(body.level) ? body.level : 'junior',
    type: TYPES.includes(body.type) ? body.type : 'technical',
    questionCount: int(body.questionCount, 3, 15, 6),
    answerSeconds: int(body.answerSeconds, 30, 600, 150),
    thinkSeconds: int(body.thinkSeconds, 0, 60, 10),
    // "end" grades everything in a few batched calls at the finish: fewer AI calls,
    // but no per-answer feedback and therefore no follow-ups.
    grading: GRADING.includes(body.grading) ? body.grading : 'each',
    modelAnswers: MODEL_ANSWERS.includes(body.modelAnswers) ? body.modelAnswers : 'brief',
    followUps: body.followUps !== false && body.grading !== 'end',
    context: text(body.context, 6000),
  };
}

const newQuestion = (q, followUpOf = null) => ({
  id: randomUUID().slice(0, 8),
  text: q.text,
  kind: q.kind,
  focus: q.focus,
  difficulty: q.difficulty,
  idealPoints: q.idealPoints,
  followUpOf,
  answer: null,
  evaluation: null,
});

export function createSession(config, plannedQuestions, provider) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: 'active',
    provider,
    config,
    questions: plannedQuestions.map((q) => newQuestion(q)),
    report: null,
    completedAt: null,
  };
}

const maxFollowUps = (config) => Math.ceil(config.questionCount / 2);

/** Upper estimate of AI requests one interview needs (plan + grading + review). Mirrors the web app. */
export function estimateCalls(config) {
  if (config.grading === 'end') return 2 + Math.ceil(config.questionCount / BATCH_SIZE);
  return 2 + config.questionCount + (config.followUps ? maxFollowUps(config) : 0);
}

/** Records an answer, grades it, and may insert a follow-up question right after it. */
export async function answerQuestion(session, questionId, body, llm) {
  if (session.status !== 'active') throw new HttpError(409, 'this interview is already finished');
  const index = session.questions.findIndex((q) => q.id === questionId);
  if (index === -1) throw new HttpError(404, 'question not found');
  const question = session.questions[index];

  const transcript = text(body.transcript, 20000);
  const skipped = !!body.skipped || !transcript;
  const metrics = computeMetrics(transcript, Number(body.durationSec) || 0, int(body.pauseCount, 0, 1000, 0));
  question.answer = {
    transcript,
    skipped,
    metrics,
    inputMode: body.inputMode === 'typed' ? 'typed' : 'voice',
    answeredAt: new Date().toISOString(),
  };

  const hasFollowUp = session.questions.some((q) => q.followUpOf === question.id);
  const followUpsUsed = session.questions.filter((q) => q.followUpOf).length;
  const allowFollowUp =
    session.config.followUps && !question.followUpOf && !hasFollowUp && followUpsUsed < maxFollowUps(session.config);

  if (skipped) {
    question.evaluation = {
      ...normalizeEvaluation({ summary: 'Skipped. No answer was given.' }, { kind: question.kind, allowFollowUp: false }),
      provider: null,
    };
    return { question, followUp: null };
  }

  if (session.config.grading === 'end') {
    question.evaluation = null;
    return { question, followUp: null, deferred: true };
  }

  const { data, provider, model } = await llm.run('evaluate', {
    config: session.config,
    question,
    answer: transcript,
    metrics,
    allowFollowUp,
  });
  question.evaluation = withModelAnswerSetting({ ...data, provider, model }, session.config);

  let followUp = null;
  if (allowFollowUp && data.followUp) {
    followUp = newQuestion(
      {
        text: data.followUp,
        kind: question.kind,
        focus: question.focus,
        difficulty: question.difficulty,
        idealPoints: question.evaluation.missedPoints.length ? question.evaluation.missedPoints : question.idealPoints,
      },
      question.id,
    );
    session.questions.splice(index + 1, 0, followUp);
  }
  return { question, followUp };
}

const withModelAnswerSetting = (evaluation, config) => (config.modelAnswers === 'off' ? { ...evaluation, modelAnswer: '' } : evaluation);

/** Answered questions still waiting for a grade (deferred grading, or a retry after a failed finish). */
const ungraded = (session) => session.questions.filter((q) => q.answer && !q.answer.skipped && !q.evaluation);

/**
 * Grades deferred answers a few at a time. Each batch is reported through onProgress so
 * it can be saved: if a later batch hits a rate limit, a retry only redoes what's left.
 */
export async function gradePending(session, llm, onProgress = () => {}) {
  const pending = ungraded(session);
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const chunk = pending.slice(i, i + BATCH_SIZE);
    const { data, provider, model } = await llm.run('evaluateBatch', {
      config: session.config,
      items: chunk.map((q) => ({ question: q, answer: q.answer.transcript, metrics: q.answer.metrics })),
    });
    chunk.forEach((q, j) => (q.evaluation = withModelAnswerSetting({ ...data[j], provider, model }, session.config)));
    onProgress(session);
  }
  return pending.length;
}

/** Writes (and stores) a model answer for one question on request. */
export async function generateModelAnswer(session, questionId, llm) {
  const question = session.questions.find((q) => q.id === questionId);
  if (!question) throw new HttpError(404, 'question not found');
  if (question.evaluation?.modelAnswer) return question;
  const { data } = await llm.run('modelAnswer', { config: session.config, question });
  question.evaluation = { ...(question.evaluation || {}), modelAnswer: data };
  return question;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (n) => +n.toFixed(1);

export function summarizeDelivery(questions) {
  const spoken = questions.filter((q) => q.answer && !q.answer.skipped);
  const voiced = spoken.filter((q) => q.answer.inputMode === 'voice' && q.answer.metrics.wpm > 0);
  return {
    answered: spoken.length,
    total: questions.length,
    avgWpm: Math.round(avg(voiced.map((q) => q.answer.metrics.wpm))),
    totalFillers: spoken.reduce((n, q) => n + q.answer.metrics.fillerCount, 0),
    avgFillerRate: round1(avg(spoken.map((q) => q.answer.metrics.fillerRate))),
    totalPauses: spoken.reduce((n, q) => n + q.answer.metrics.pauseCount, 0),
    speakingSec: spoken.reduce((n, q) => n + q.answer.metrics.durationSec, 0),
    avgWords: Math.round(avg(spoken.map((q) => q.answer.metrics.wordCount))),
    avgDelivery: round1(avg(spoken.map((q) => q.answer.metrics.delivery))),
  };
}

export async function finishSession(session, llm, onProgress = () => {}) {
  if (session.status === 'completed' && session.report) return session;
  await gradePending(session, llm, onProgress);
  for (const q of session.questions) {
    if (!q.answer) {
      q.answer = { transcript: '', skipped: true, metrics: computeMetrics('', 0, 0), inputMode: 'voice', answeredAt: null };
      q.evaluation = { ...normalizeEvaluation({ summary: 'Not answered.' }, { kind: q.kind, allowFollowUp: false }), provider: null };
    }
  }
  const delivery = summarizeDelivery(session.questions);
  const turns = session.questions.map((q) => ({
    text: q.text,
    kind: q.kind,
    focus: q.focus,
    skipped: q.answer.skipped,
    evaluation: q.evaluation,
  }));
  const { data, provider, model } = await llm.run('review', { config: session.config, turns, delivery });

  const graded = session.questions.filter((q) => !q.answer.skipped);
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((d) => [d, round1(avg(graded.map((q) => q.evaluation.scores[d])))]),
  );
  dimensions.delivery = delivery.avgDelivery;

  session.report = { ...data, dimensions, delivery, provider, model };
  session.status = 'completed';
  session.completedAt = new Date().toISOString();
  return session;
}

/** Builds a practice session from previously weak answers, without an AI planning call. */
export function weakQuestions(sessions, threshold = 6) {
  const seen = new Set();
  const out = [];
  for (const s of sessions) {
    if (s.status !== 'completed') continue;
    for (const q of s.questions) {
      if (q.followUpOf || !q.evaluation || q.evaluation.overall >= threshold || seen.has(q.text)) continue;
      seen.add(q.text);
      out.push({ ...q, sessionId: s.id, topic: s.config.topic, score: q.evaluation.overall, date: s.createdAt });
    }
  }
  return out;
}

export function computeStats(sessions) {
  const completed = sessions.filter((s) => s.status === 'completed' && s.report);
  const byTopic = {};
  for (const s of completed) {
    const t = (byTopic[s.config.topic] ||= { topic: s.config.topic, count: 0, total: 0, best: 0, last: null });
    t.count += 1;
    t.total += s.report.overallScore;
    t.best = Math.max(t.best, s.report.overallScore);
    t.last ||= s.createdAt;
  }
  const days = new Set(completed.map((s) => s.createdAt.slice(0, 10)));
  let streak = 0;
  for (let d = new Date(); days.has(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1)) streak += 1;

  return {
    totalSessions: sessions.length,
    completedSessions: completed.length,
    avgScore: completed.length ? Math.round(avg(completed.map((s) => s.report.overallScore))) : null,
    bestScore: completed.length ? Math.max(...completed.map((s) => s.report.overallScore)) : null,
    questionsAnswered: completed.reduce((n, s) => n + s.questions.filter((q) => !q.answer?.skipped).length, 0),
    practiceMinutes: Math.round(completed.reduce((n, s) => n + (s.report.delivery?.speakingSec || 0), 0) / 60),
    streakDays: streak,
    byTopic: Object.values(byTopic)
      .map(({ total, ...t }) => ({ ...t, avg: Math.round(total / t.count) }))
      .sort((a, b) => b.count - a.count),
    trend: completed
      .slice(0, 30)
      .reverse()
      .map((s) => ({ id: s.id, date: s.createdAt, score: s.report.overallScore, topic: s.config.topic })),
    weakCount: weakQuestions(completed).length,
  };
}

/** Light listing shape for the history page. */
export function summarizeSession(s) {
  return {
    id: s.id,
    createdAt: s.createdAt,
    completedAt: s.completedAt,
    status: s.status,
    config: { topic: s.config.topic, field: s.config.field || '', role: s.config.role, level: s.config.level, type: s.config.type },
    questionCount: s.questions.length,
    answered: s.questions.filter((q) => q.answer && !q.answer.skipped).length,
    overallScore: s.report?.overallScore ?? null,
    headline: s.report?.headline ?? null,
    provider: s.provider,
  };
}
