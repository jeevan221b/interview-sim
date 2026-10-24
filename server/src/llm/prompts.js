// Prompts for the three AI tasks. Every task returns strict JSON; the shape is spelled
// out in the prompt (portable across providers) and enforced again by normalize.js.

export const DIMENSIONS = ['accuracy', 'depth', 'structure', 'clarity', 'relevance'];

const LEVEL_HINT = {
  intern: 'an intern / fresher / student with mostly academic and project or internship experience',
  junior: 'a junior professional with about 0–2 years of experience',
  mid: 'a mid-level professional with about 2–5 years of experience',
  senior: 'a senior professional with 5+ years of experience who is expected to own complex work',
  lead: 'a lead / principal-level professional expected to set direction and mentor others',
};

const TYPE_HINT = {
  technical:
    'Only technical / subject-knowledge questions for this field: concepts, reasoning, trade-offs, practical and case or scenario questions.',
  behavioral:
    'Only behavioral / HR questions answerable with the STAR method (Situation, Task, Action, Result).',
  mixed: 'Roughly 70% technical / subject-knowledge and 30% behavioral questions, technical first.',
};

// Model answers are the largest part of every grading response, so their length is a
// per-interview setting; "off" leaves them out and the report can fetch one on demand.
const MODEL_ANSWER_RULE = {
  brief: '"modelAnswer": a strong but concise spoken answer of 40–70 words the candidate could learn from.',
  full: '"modelAnswer": a strong spoken answer of 80–160 words the candidate could learn from.',
  off: 'Set "modelAnswer" to an empty string "" (it is not needed).',
};
const modelAnswerRule = (config) => MODEL_ANSWER_RULE[config.modelAnswers] || MODEL_ANSWER_RULE.brief;

const SCORING_RULES = (kindNote) => `Scoring: each dimension is 0–10 (5 = acceptable, 7 = good, 9+ = exceptional).
- accuracy: is it technically / factually / clinically correct for this field (for behavioral: is the example credible and substantive)
- depth: goes beyond surface level: reasoning, trade-offs, examples, edge cases or exceptions
- structure: logical flow; for behavioral, follows STAR
- clarity: easy to follow, concise, precise wording
- relevance: answers the actual question asked
"overall" is your holistic 0–10 judgement (not a plain average).
${kindNote}`;

const GRADER_SYSTEM = `You are a fair but demanding interviewer grading answers from a mock interview.
The answers were spoken aloud and transcribed by speech-to-text, so ignore transcription errors,
missing punctuation and minor grammar. Judge substance and how well it would land in a real interview.
First decide which ideal points were covered or missed, then score. Respond with JSON only.`;

/** One-line description of who is being interviewed, for any field. */
function describeRole(config) {
  const role = config.role || (config.field ? `candidate in ${config.field}` : `candidate for a ${config.topic} role`);
  return config.field ? `${role} (${config.field})` : role;
}

const json = (value) => JSON.stringify(value, null, 2);

export function planPrompt(config) {
  const system = `You are an experienced interviewer and subject-matter expert${config.field ? ` in ${config.field}` : ''},
preparing a realistic mock interview of the kind used for jobs, campus placements, residencies or vivas in this field.
Use the terminology, standards and real-world situations of that field (engineering, medicine, business or anything else).
You write clear, specific, spoken-style questions (one question at a time, no multi-part lists),
ordered from warm-up to hardest. Respond with JSON only.`;

  const user = `Prepare ${config.questionCount} interview questions.

Topic: ${config.topic}${config.field ? `\nField: ${config.field}` : ''}${config.focus ? `\nFocus areas (prioritise these): ${config.focus}` : ''}
Role: ${describeRole(config)}
Candidate level: ${LEVEL_HINT[config.level] || config.level}
Interview type: ${TYPE_HINT[config.type] || config.type}
${config.context ? `\nJob description / candidate background (tailor questions to it):\n"""\n${config.context}\n"""\n` : ''}
Rules:
- Each question must be answerable verbally in 1–3 minutes.
- Mix conceptual, practical and scenario/case questions; avoid trivia and yes/no questions.
- Questions must be about the topic itself; do not drift into software unless the topic is software.
- "idealPoints" are 3–6 short points a strong answer would cover (used later for grading).

Return JSON exactly like:
${json({
  questions: [
    {
      text: 'the question, phrased as the interviewer would say it',
      kind: 'technical | behavioral',
      focus: 'short label of the concept tested',
      difficulty: 'easy | medium | hard',
      idealPoints: ['point', 'point', 'point'],
    },
  ],
})}`;
  return { system, user };
}

export function evaluatePrompt({ config, question, answer, metrics, allowFollowUp }) {
  const user = `Interview: ${config.topic} — ${describeRole(config)} (${config.level})

Question (${question.kind}, ${question.difficulty}): ${question.text}
Ideal points: ${json(question.idealPoints)}

Candidate's answer (transcribed, ${metrics.wordCount} words, ${metrics.durationSec}s, ${metrics.wpm || 'n/a'} wpm, ${metrics.fillerCount} filler words):
"""
${answer || '(no answer given)'}
"""

${SCORING_RULES(question.kind === 'behavioral' ? '"star" marks which STAR parts are clearly present.' : 'Set "star" to null.')}
${
  allowFollowUp
    ? '"followUp": ONE natural probing follow-up question an interviewer would ask next (dig into something vague, missing or interesting). Use null if the answer was empty or nothing worth probing.'
    : 'Set "followUp" to null.'
}
${modelAnswerRule(config)}

Return JSON exactly like:
${json({
  scores: { accuracy: 0, depth: 0, structure: 0, clarity: 0, relevance: 0 },
  overall: 0,
  verdict: 'strong | good | fair | weak',
  summary: 'one or two sentences of direct feedback',
  strengths: ['specific strength'],
  improvements: ['specific, actionable improvement'],
  coveredPoints: ['ideal point that was covered'],
  missedPoints: ['ideal point that was missed'],
  star: { situation: true, task: true, action: true, result: false },
  followUp: 'string or null',
  modelAnswer: 'string',
})}`;
  return { system: GRADER_SYSTEM, user };
}

/** Grades several answers in one call (used when grading is deferred to the end). */
export function evaluateBatchPrompt({ config, items }) {
  const user = `Interview: ${config.topic} — ${describeRole(config)} (${config.level})

Grade each of these ${items.length} answers independently.

${items
  .map(
    ({ question, answer, metrics }) => `### id: ${question.id}
Question (${question.kind}, ${question.difficulty}): ${question.text}
Ideal points: ${json(question.idealPoints)}
Answer (transcribed, ${metrics.wordCount} words, ${metrics.durationSec}s, ${metrics.fillerCount} filler words):
"""
${answer}
"""`,
  )
  .join('\n\n')}

${SCORING_RULES('"star" marks which STAR parts are clearly present for behavioral questions; null for technical ones.')}
${modelAnswerRule(config)}
Keep every list short (1–3 items) and every summary to one or two sentences.

Return JSON exactly like (one entry per id above, same ids):
${json({
  evaluations: [
    {
      id: 'the id',
      scores: { accuracy: 0, depth: 0, structure: 0, clarity: 0, relevance: 0 },
      overall: 0,
      verdict: 'strong | good | fair | weak',
      summary: 'direct feedback',
      strengths: ['specific strength'],
      improvements: ['specific, actionable improvement'],
      coveredPoints: ['ideal point that was covered'],
      missedPoints: ['ideal point that was missed'],
      star: null,
      modelAnswer: 'string',
    },
  ],
})}`;
  return { system: GRADER_SYSTEM, user };
}

/** A model answer requested later from the report. */
export function modelAnswerPrompt({ config, question }) {
  const system = `You are an expert${config.field ? ` in ${config.field}` : ''} coaching a candidate for interviews.
Write answers the way a strong candidate would say them out loud. Respond with JSON only.`;
  const user = `Interview: ${config.topic} — ${describeRole(config)} (${config.level})
Question (${question.kind}): ${question.text}
Points a strong answer covers: ${json(question.idealPoints)}

Write a strong spoken answer of 80–140 words${question.kind === 'behavioral' ? ' following STAR' : ''}.
Return JSON exactly like: ${json({ modelAnswer: 'string' })}`;
  return { system, user };
}

export function reviewPrompt({ config, turns, delivery }) {
  const system = `You are an interview coach writing the debrief after a full mock interview.
Be specific, honest and encouraging; refer to actual answers. Respond with JSON only.`;

  const user = `Interview: ${config.topic} — ${describeRole(config)} (${config.level}, ${config.type})

Per-question results:
${json(
  turns.map((t, i) => ({
    n: i + 1,
    question: t.text,
    kind: t.kind,
    skipped: t.skipped,
    overall: t.evaluation?.overall ?? 0,
    summary: t.evaluation?.summary ?? '',
    missed: t.evaluation?.missedPoints ?? [],
  })),
)}

Delivery stats across the interview: ${json(delivery)}

Return JSON exactly like:
${json({
  overallScore: 0,
  headline: 'one-line verdict, max 12 words',
  summary: '3–4 sentence debrief',
  hiringSignal: 'strong-hire | hire | lean-hire | lean-no | no',
  strengths: ['top strength', 'top strength', 'top strength'],
  improvements: ['most important improvement', 'second', 'third'],
  studyTopics: ['concrete topic to study'],
  communicationTips: ['tip about delivery, pace, fillers or structure'],
  nextSteps: ['what to practice in the next session'],
})}
"overallScore" is 0–100 and should reflect both content (most weight) and delivery.`;
  return { system, user };
}
