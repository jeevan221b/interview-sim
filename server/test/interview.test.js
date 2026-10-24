import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeMetrics, findFillers, splitFillers } from '../../shared/metrics.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createLlm } from '../src/llm/index.js';
import { planPrompt } from '../src/llm/prompts.js';
import { extractJson, normalizeEvaluation, normalizePlan } from '../src/llm/normalize.js';

const quiet = { warn() {} };

function makeApp(llm = createLlm({ ...loadConfig({}).llm, providers: ['mock'] }, { log: quiet })) {
  const config = loadConfig({ DB_PATH: ':memory:', WEB_DIST: '/nonexistent' });
  return createApp({ config, db: openDb(':memory:'), llm });
}

const call = async (app, method, path, body) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('full interview flow with the mock interviewer', async () => {
  const app = makeApp();
  const created = await call(app, 'POST', '/api/sessions', { topic: 'React', questionCount: 3, followUps: true });
  assert.equal(created.status, 201);
  const session = created.body;
  assert.equal(session.questions.length, 3);
  assert.match(session.questions[0].text, /React/);

  // A short answer triggers a follow-up, which is inserted right after the question.
  const short = await call(app, 'POST', `/api/sessions/${session.id}/questions/${session.questions[0].id}/answer`, {
    transcript: 'Um, React is basically a library for building user interfaces with components.',
    durationSec: 6,
  });
  assert.equal(short.status, 200);
  assert.ok(short.body.followUp, 'expected a follow-up question');
  assert.equal(short.body.session.questions.length, 4);
  assert.equal(short.body.session.questions[1].followUpOf, session.questions[0].id);
  assert.ok(short.body.question.answer.metrics.fillerCount >= 2);

  // Follow-ups don't get follow-ups of their own.
  const fu = short.body.session.questions[1];
  const fuRes = await call(app, 'POST', `/api/sessions/${session.id}/questions/${fu.id}/answer`, { transcript: 'Sure, for example...', durationSec: 3 });
  assert.equal(fuRes.body.followUp, null);

  const skip = await call(app, 'POST', `/api/sessions/${session.id}/questions/${session.questions[1].id}/answer`, { skipped: true });
  assert.equal(skip.body.question.evaluation.overall, 0);

  const done = await call(app, 'POST', `/api/sessions/${session.id}/finish`);
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'completed');
  assert.ok(done.body.report.overallScore >= 0 && done.body.report.overallScore <= 100);
  assert.ok('delivery' in done.body.report.dimensions);
  assert.ok(done.body.questions.every((q) => q.answer), 'unanswered questions are marked skipped');

  const answerAgain = await call(app, 'POST', `/api/sessions/${session.id}/questions/${session.questions[0].id}/answer`, { transcript: 'x' });
  assert.equal(answerAgain.status, 409);

  const stats = await call(app, 'GET', '/api/stats');
  assert.equal(stats.body.completedSessions, 1);
  assert.equal(stats.body.byTopic[0].topic, 'React');

  const list = await call(app, 'GET', '/api/sessions');
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].questions, undefined, 'listing is the light summary shape');

  const weak = await call(app, 'POST', '/api/sessions/weak', {});
  assert.equal(weak.status, 201);
  assert.ok(weak.body.questions.every((q) => !q.answer));

  assert.equal((await call(app, 'DELETE', `/api/sessions/${session.id}`)).status, 200);
  assert.equal((await call(app, 'GET', `/api/sessions/${session.id}`)).status, 404);
});

test('rejects a session without a topic', async () => {
  const res = await call(makeApp(), 'POST', '/api/sessions', { topic: '  ' });
  assert.equal(res.status, 400);
});

test('custom topics in any field keep field and focus', async () => {
  const app = makeApp();
  const { status, body } = await call(app, 'POST', '/api/sessions', {
    topic: 'Transformers',
    field: 'Electrical & Electronics',
    focus: 'losses, cooling, protection',
    questionCount: 3,
  });
  assert.equal(status, 201);
  assert.equal(body.config.field, 'Electrical & Electronics');
  assert.equal(body.config.focus, 'losses, cooling, protection');
  assert.equal(body.config.role, '');
  assert.ok(body.questions.every((q) => !/developer|production|\bCI\b/i.test(q.text)));
  const list = await call(app, 'GET', '/api/sessions');
  assert.equal(list.body[0].config.field, 'Electrical & Electronics');
});

test('plan prompt is field-aware rather than software-only', () => {
  const { system, user } = planPrompt({ topic: 'Cardiology', field: 'Medical & Healthcare', focus: 'ECG, heart failure', role: '', level: 'junior', type: 'technical', questionCount: 5, context: '' });
  assert.match(system, /Medical & Healthcare/);
  assert.match(user, /Focus areas \(prioritise these\): ECG, heart failure/);
  assert.match(user, /Role: candidate in Medical & Healthcare/);
  assert.doesNotMatch(system + user, /Software Engineer|technology company/);
});

test('deferred grading: answers are stored, then graded in batches at the finish', async () => {
  const app = makeApp();
  const created = await call(app, 'POST', '/api/sessions', { topic: 'Pharmacology', field: 'Medical & Healthcare', questionCount: 5, grading: 'end', modelAnswers: 'off' });
  assert.equal(created.body.config.grading, 'end');
  assert.equal(created.body.config.followUps, false);
  const id = created.body.id;
  for (const q of created.body.questions) {
    const r = await call(app, 'POST', `/api/sessions/${id}/questions/${q.id}/answer`, {
      transcript: 'Beta blockers reduce heart rate by blocking beta adrenergic receptors, and we monitor for bradycardia.',
      durationSec: 20,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.deferred, true);
    assert.equal(r.body.question.evaluation, null);
    assert.equal(r.body.followUp, null);
  }
  const done = await call(app, 'POST', `/api/sessions/${id}/finish`);
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'completed');
  assert.equal(done.body.questions.length, 5);
  assert.ok(done.body.questions.every((q) => q.evaluation && q.evaluation.scores && q.evaluation.modelAnswer === ''));

  // Model answers were off, so the report can ask for one later.
  const qid = done.body.questions[0].id;
  const ma = await call(app, 'POST', `/api/sessions/${id}/questions/${qid}/model-answer`);
  assert.equal(ma.status, 200);
  assert.ok(ma.body.question.evaluation.modelAnswer.length > 20);
  assert.ok(ma.body.question.evaluation.scores, 'existing grade is kept');
});

test('falls back to the next provider when one fails', async () => {
  const llm = createLlm({ ...loadConfig({}).llm, providers: ['mock'] }, { log: quiet });
  let calls = 0;
  const flaky = {
    providers: llm.providers,
    run: async (task, input) => {
      calls += 1;
      return llm.run(task, input);
    },
  };
  const res = await call(makeApp(flaky), 'POST', '/api/sessions', { topic: 'SQL', questionCount: 4 });
  assert.equal(res.status, 201);
  assert.equal(calls, 1);

  const broken = createLlm(
    { ...loadConfig({}).llm, providers: ['gemini', 'mock'], gemini: { apiKey: 'k', model: 'm' } },
    { log: quiet },
  );
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('quota', { status: 429 });
  try {
    const { provider } = await broken.run('plan', { topic: 'Go', questionCount: 3, type: 'technical' });
    assert.equal(provider, 'mock');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('extractJson handles fences and chatter', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('here you go {"a": {"b": 2}} thanks'), { a: { b: 2 } });
  assert.throws(() => extractJson('no json here'));
});

test('normalizers clamp scores and fill defaults', () => {
  const ev = normalizeEvaluation({ scores: { accuracy: 14, depth: -2, structure: '7' }, followUp: 'null' }, { kind: 'technical', allowFollowUp: true });
  assert.equal(ev.scores.accuracy, 10);
  assert.equal(ev.scores.depth, 0);
  assert.equal(ev.scores.structure, 7);
  assert.equal(ev.followUp, null);
  assert.equal(ev.star, null);
  assert.ok(['strong', 'good', 'fair', 'weak'].includes(ev.verdict));

  const plan = normalizePlan({ questions: [{ question: 'What is a closure in JavaScript?' }, { text: 'hi' }] }, { topic: 'JS', type: 'technical', questionCount: 5 });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, 'technical');
  assert.throws(() => normalizePlan({}, { topic: 'JS', questionCount: 3 }));
});

test('speech metrics', () => {
  const text = 'Um so basically, you know, I think like the virtual DOM is, uh, a diff layer.';
  const fillers = findFillers(text);
  assert.equal(fillers.total, 5);
  assert.equal(fillers.byWord['you know'], 1);
  assert.equal(splitFillers(text).map((p) => p.text).join(''), text);

  const m = computeMetrics('word '.repeat(140), 60, 1);
  assert.equal(m.wpm, 140);
  assert.equal(m.fillerCount, 0);
  assert.ok(m.delivery >= 9);
  assert.equal(computeMetrics('', 0, 0).delivery, 0);
  assert.ok(computeMetrics('um '.repeat(30) + 'word '.repeat(30), 20, 6).delivery < 5);
});
