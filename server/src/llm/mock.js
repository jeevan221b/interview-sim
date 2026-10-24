// Offline interviewer used when no API key is configured (and in tests). Questions come
// from templates and grading is a keyword-coverage heuristic: good enough to try the
// whole flow, not a substitute for a real model.

import { countWords } from '../../../shared/metrics.js';

// Field-neutral on purpose: these have to read sensibly for software, electrical,
// medical, business or any custom topic.
const TECHNICAL = [
  {
    text: 'To warm up: how would you explain {topic} to a colleague or junior who is new to it?',
    focus: 'Fundamentals',
    difficulty: 'easy',
    idealPoints: ['clear definition', 'why it matters', 'a concrete example', 'key limitations or exceptions'],
  },
  {
    text: 'Walk me through a project, case or situation where you applied {topic}. What decisions did you make and why?',
    focus: 'Practical experience',
    difficulty: 'easy',
    idealPoints: ['context of the situation', 'your specific role', 'a decision and its reasoning', 'the outcome or result'],
  },
  {
    text: 'What are the most common mistakes people make in {topic}, and how do you avoid them?',
    focus: 'Pitfalls',
    difficulty: 'medium',
    idealPoints: ['at least two concrete mistakes', 'why they happen', 'how to prevent them', 'checks or standards that help'],
  },
  {
    text: 'Compare two different methods or approaches used in {topic}. When would you choose one over the other?',
    focus: 'Trade-offs',
    difficulty: 'medium',
    idealPoints: ['names both approaches', 'strengths of each', 'weaknesses of each', 'decision criteria'],
  },
  {
    text: 'How do you make sure your work in {topic} is correct, safe and meets the required standards?',
    focus: 'Quality & safety',
    difficulty: 'medium',
    idealPoints: ['verification or testing', 'relevant standards or guidelines', 'safety considerations', 'documentation or review'],
  },
  {
    text: 'Something goes wrong unexpectedly in a real situation involving {topic}. How do you investigate and resolve it?',
    focus: 'Troubleshooting',
    difficulty: 'hard',
    idealPoints: ['assess and stabilise first', 'gather data or observations', 'form and test a hypothesis', 'fix and prevent recurrence'],
  },
  {
    text: 'Describe the hardest or most complex problem you could face in {topic}. How would you approach it end to end?',
    focus: 'Complex scenario',
    difficulty: 'hard',
    idealPoints: ['breaks the problem down', 'key constraints and risks', 'step-by-step approach', 'how success is measured'],
  },
  {
    text: 'What is a recent development or advance in {topic} that you think matters, and how would it change the way you work?',
    focus: 'Staying current',
    difficulty: 'medium',
    idealPoints: ['names a specific development', 'why it matters', 'impact on day-to-day work'],
  },
];

const BEHAVIORAL = [
  'Tell me about a time you had to deliver something under a tight deadline. How did you handle it?',
  'Describe a situation where you disagreed with a teammate or manager. What did you do?',
  'Tell me about a mistake you made at work or in a project, and what you learned from it.',
  'Give me an example of a time you took ownership of a problem nobody else wanted to handle.',
  'Tell me about a time you had to learn something new very quickly to get a task done.',
  'Describe a time you received critical feedback. How did you respond?',
  'Tell me about the project you are most proud of and your specific contribution to it.',
  'Describe a situation where requirements changed late. How did you adapt?',
].map((text) => ({
  text,
  focus: 'Behavioral',
  difficulty: 'medium',
  idealPoints: ['situation with context', 'your task or responsibility', 'specific actions you took', 'measurable result', 'what you learned'],
}));

function plan(config) {
  const tech = TECHNICAL.map((q) => ({ ...q, kind: 'technical', text: q.text.replaceAll('{topic}', config.topic) }));
  const beh = BEHAVIORAL.map((q) => ({ ...q, kind: 'behavioral' }));
  const n = config.questionCount;
  let pool;
  if (config.type === 'behavioral') pool = beh;
  else if (config.type === 'mixed') {
    const behCount = Math.max(1, Math.round(n * 0.3));
    pool = [...tech.slice(0, n - behCount), ...beh.slice(0, behCount)];
  } else pool = tech;
  // Repeat the pool if more questions are requested than templates exist.
  const questions = Array.from({ length: n }, (_, i) => pool[i % pool.length]);
  return { questions };
}

const stem = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(ing|ed|es|s)$/, '');

function evaluate({ question, answer, allowFollowUp }) {
  const words = countWords(answer);
  const answerStems = new Set((answer || '').split(/\s+/).map(stem).filter((w) => w.length > 2));
  const covered = [];
  const missed = [];
  for (const point of question.idealPoints) {
    const keys = point.split(/\s+/).map(stem).filter((w) => w.length > 3);
    (keys.some((k) => answerStems.has(k)) ? covered : missed).push(point);
  }
  const coverage = question.idealPoints.length ? covered.length / question.idealPoints.length : 0;
  const lengthScore = Math.min(10, words / 18);
  const base = words === 0 ? 0 : 3 + coverage * 4 + lengthScore * 0.3;
  const s = (offset) => +Math.max(0, Math.min(10, base + offset)).toFixed(1);
  const scores = { accuracy: s(0.3), depth: s(lengthScore > 6 ? 0.5 : -1), structure: s(0), clarity: s(0.5), relevance: s(1) };
  const overall = +(Object.values(scores).reduce((a, b) => a + b, 0) / 5).toFixed(1);

  return {
    scores,
    overall,
    summary:
      words === 0
        ? 'No answer was given for this question.'
        : coverage >= 0.6
          ? 'Solid answer that touches most of the key points. Add a concrete example to make it memorable.'
          : 'The answer stays fairly high level. Cover more of the key points and back them up with specifics.',
    strengths: words === 0 ? [] : [covered.length ? `You covered: ${covered.slice(0, 2).join(', ')}` : 'You attempted the question directly'],
    improvements: missed.length ? missed.slice(0, 3).map((p) => `Address ${p}`) : ['Tighten the answer and lead with the key point'],
    coveredPoints: covered,
    missedPoints: missed,
    star:
      question.kind === 'behavioral'
        ? {
            situation: /when|time|project|team|at my/i.test(answer),
            task: /responsib|goal|needed|had to|task/i.test(answer),
            action: /\bi (did|decided|built|wrote|talked|created|led|started|changed)/i.test(answer),
            result: /result|outcome|improv|reduc|increas|%|percent|deliver/i.test(answer),
          }
        : null,
    followUp:
      allowFollowUp && words > 0 && words < 80
        ? 'Can you go one level deeper on that, ideally with a concrete example from your own work?'
        : null,
    modelAnswer: `A strong answer would cover ${question.idealPoints.join(', ')}. Start with a one-sentence direct answer, then walk through each point with a short, concrete example from real experience, and finish by summarising the trade-off or result. (Mock interviewer: set a Groq API key for real model answers.)`,
  };
}

function review({ turns, delivery }) {
  const scores = turns.map((t) => t.evaluation?.overall ?? 0);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const overallScore = Math.round(avg * 8.5 + (delivery.avgDelivery || 0) * 1.5);
  const weakest = [...turns].sort((a, b) => (a.evaluation?.overall ?? 0) - (b.evaluation?.overall ?? 0))[0];
  return {
    overallScore,
    headline: overallScore >= 70 ? 'Good showing with room to sharpen' : 'Promising start, needs more depth',
    summary: `You answered ${turns.filter((t) => !t.skipped).length} of ${turns.length} questions with an average content score of ${avg.toFixed(1)}/10. This report comes from the offline mock interviewer, so treat the scores as rough. Add a Groq API key for real feedback.`,
    hiringSignal: overallScore >= 80 ? 'hire' : overallScore >= 65 ? 'lean-hire' : 'lean-no',
    strengths: ['You engaged with every question', 'Answers stayed on topic', 'Consistent pace'],
    improvements: [
      weakest ? `Revisit: "${weakest.text.slice(0, 80)}"` : 'Go deeper on each answer',
      'Use concrete examples from your own projects',
      'Lead with a one-sentence answer, then expand',
    ],
    studyTopics: [...new Set(turns.map((t) => t.focus))].slice(0, 4),
    communicationTips: [
      delivery.totalFillers > 5 ? `Cut filler words (${delivery.totalFillers} this session)` : 'Keep fillers low, as you did',
      'Pause briefly instead of saying "um"',
    ],
    nextSteps: ['Retry your weakest questions', 'Do a timed session at the next difficulty level'],
  };
}

function evaluateBatch({ items }) {
  return { evaluations: items.map(({ question, answer }) => ({ id: question.id, ...evaluate({ question, answer, allowFollowUp: false }) })) };
}

function modelAnswer({ question }) {
  return { modelAnswer: evaluate({ question, answer: '', allowFollowUp: false }).modelAnswer };
}

export function mock() {
  return { name: 'mock', label: 'Mock interviewer (offline)', available: true, tasks: { plan, evaluate, evaluateBatch, modelAnswer, review } };
}
