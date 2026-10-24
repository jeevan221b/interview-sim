// Models don't always follow the requested JSON shape exactly. These functions coerce
// whatever came back into the shape the app relies on, or throw if it is unusable.

import { DIMENSIONS } from './prompts.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const toNum = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? +clamp(n, lo, hi).toFixed(1) : lo;
};
const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, max = 8) =>
  (Array.isArray(v) ? v : [])
    .map((x) => str(typeof x === 'string' ? x : x?.text ?? '', 400))
    .filter(Boolean)
    .slice(0, max);
const oneOf = (v, options, fallback) => {
  const s = String(v || '').toLowerCase().trim();
  return options.includes(s) ? s : fallback;
};

/** Pulls the first JSON object out of a model response (handles ``` fences and chatter). */
export function extractJson(text) {
  if (text && typeof text === 'object') return text;
  // Some reasoning models (qwen) inline their thinking in <think> tags.
  const raw = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('model response contained no JSON object');
  return JSON.parse(body.slice(start, end + 1));
}

export function normalizePlan(data, config) {
  const fallbackKind = config.type === 'behavioral' ? 'behavioral' : 'technical';
  const questions = (Array.isArray(data?.questions) ? data.questions : [])
    .map((q) => ({
      text: str(q?.text ?? q?.question, 600),
      kind: oneOf(q?.kind, ['technical', 'behavioral'], fallbackKind),
      focus: str(q?.focus, 80) || config.topic,
      difficulty: oneOf(q?.difficulty, ['easy', 'medium', 'hard'], 'medium'),
      idealPoints: strList(q?.idealPoints, 6),
    }))
    .filter((q) => q.text.length > 8)
    .slice(0, config.questionCount);
  if (!questions.length) throw new Error('model returned no usable questions');
  return questions;
}

export function normalizeEvaluation(data, { kind, allowFollowUp }) {
  const scores = Object.fromEntries(DIMENSIONS.map((d) => [d, toNum(data?.scores?.[d], 0, 10)]));
  const avg = DIMENSIONS.reduce((sum, d) => sum + scores[d], 0) / DIMENSIONS.length;
  const overall = data?.overall === undefined ? +avg.toFixed(1) : toNum(data.overall, 0, 10);
  const verdict = oneOf(
    data?.verdict,
    ['strong', 'good', 'fair', 'weak'],
    overall >= 8 ? 'strong' : overall >= 6.5 ? 'good' : overall >= 4.5 ? 'fair' : 'weak',
  );
  const star =
    kind === 'behavioral' && data?.star && typeof data.star === 'object'
      ? {
          situation: !!data.star.situation,
          task: !!data.star.task,
          action: !!data.star.action,
          result: !!data.star.result,
        }
      : null;
  const followUp = allowFollowUp ? str(data?.followUp, 500) || null : null;
  return {
    scores,
    overall,
    verdict,
    summary: str(data?.summary, 800),
    strengths: strList(data?.strengths),
    improvements: strList(data?.improvements),
    coveredPoints: strList(data?.coveredPoints),
    missedPoints: strList(data?.missedPoints),
    star,
    followUp: followUp && followUp.toLowerCase() !== 'null' ? followUp : null,
    modelAnswer: str(data?.modelAnswer, 3000),
  };
}

export function normalizeReview(data) {
  return {
    overallScore: Math.round(toNum(data?.overallScore, 0, 100)),
    headline: str(data?.headline, 160),
    summary: str(data?.summary, 2000),
    hiringSignal: oneOf(data?.hiringSignal, ['strong-hire', 'hire', 'lean-hire', 'lean-no', 'no'], 'lean-no'),
    strengths: strList(data?.strengths, 5),
    improvements: strList(data?.improvements, 5),
    studyTopics: strList(data?.studyTopics, 8),
    communicationTips: strList(data?.communicationTips, 5),
    nextSteps: strList(data?.nextSteps, 5),
  };
}

/** Matches batch results back to their questions; a missing one makes the whole batch unusable. */
export function normalizeBatch(data, items) {
  const list = Array.isArray(data?.evaluations) ? data.evaluations : Array.isArray(data) ? data : [];
  const byId = new Map(list.map((e) => [String(e?.id ?? ''), e]));
  return items.map(({ question }, i) => {
    const raw = byId.get(question.id) ?? (list.length === items.length ? list[i] : undefined);
    if (!raw) throw new Error(`model skipped the answer to question ${question.id}`);
    return normalizeEvaluation(raw, { kind: question.kind, allowFollowUp: false });
  });
}

export function normalizeModelAnswer(data) {
  const answer = str(typeof data === 'string' ? data : data?.modelAnswer, 3000);
  if (answer.length < 20) throw new Error('model returned no usable model answer');
  return answer;
}
