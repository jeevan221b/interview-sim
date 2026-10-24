import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLlm } from '../src/llm/index.js';
import { createQuota, parseDuration } from '../src/llm/quota.js';

const quiet = { warn() {} };
const config = { questionCount: 3, topic: 'Transformers', field: 'Electrical & Electronics', level: 'junior', type: 'technical', role: '' };
const planJson = JSON.stringify({ questions: [{ text: 'What are the main transformer losses?', kind: 'technical', difficulty: 'easy', idealPoints: ['copper', 'core'] }] });

function memoryStore() {
  const m = new Map();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, structuredClone(v)) };
}

/** Fake Groq: `script[model]` is a list of responses consumed in order. */
function fakeGroq(script) {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.model);
    const next = script[body.model]?.shift() ?? { status: 500, body: { error: { message: 'unscripted' } } };
    const headers = new Headers({
      'x-ratelimit-limit-requests': '1000',
      'x-ratelimit-remaining-requests': String(next.remaining ?? 900),
      'x-ratelimit-reset-requests': '1m26.4s',
      'x-ratelimit-limit-tokens': '8000',
      'x-ratelimit-remaining-tokens': '7000',
      'x-ratelimit-reset-tokens': '600ms',
      ...(next.retryAfter ? { 'retry-after': next.retryAfter } : {}),
    });
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers });
  };
  return { fetchImpl, calls };
}

const ok = (content, tokens = 500) => ({ body: { choices: [{ message: { content } }], usage: { total_tokens: tokens } } });
const llmFor = (fake, store = memoryStore()) =>
  createLlm(
    { providers: ['groq'], groq: { apiKey: 'test', models: ['big', 'small', 'last'], reasoningEffort: 'low' } },
    { log: quiet, store, fetchImpl: fake.fetchImpl },
  );

test('parseDuration understands Groq header formats', () => {
  assert.equal(parseDuration('1m26.4s'), 86_400);
  assert.equal(parseDuration('600ms'), 600);
  assert.equal(parseDuration('2h3m'), 7_380_000);
  assert.equal(parseDuration('7'), 7000);
  assert.equal(parseDuration(''), null);
});

test('falls back to the next Groq model when one is rate-limited, then skips it', async () => {
  const fake = fakeGroq({
    big: [{ status: 429, retryAfter: '120', body: { error: { message: 'rate limit reached for requests per day' } } }],
    small: [ok(planJson, 700), ok(planJson, 300)],
  });
  const llm = llmFor(fake);
  const first = await llm.run('plan', config);
  assert.equal(first.model, 'small');
  assert.equal(first.data[0].text, 'What are the main transformer losses?');
  // "big" is now known to be limited, so the next call goes straight to "small".
  const second = await llm.run('plan', config);
  assert.equal(second.model, 'small');
  assert.deepEqual(fake.calls, ['big', 'small', 'small']);

  const q = llm.quota();
  const big = q.models.find((m) => m.model === 'big');
  const small = q.models.find((m) => m.model === 'small');
  assert.ok(big.limitedUntil);
  assert.deepEqual(small.usedToday, { requests: 2, tokens: 1000 });
  assert.equal(small.requestsLimit, 1000);
});

test('waits briefly on a short token-per-minute 429 instead of dropping a model', async () => {
  const fake = fakeGroq({ big: [{ status: 429, retryAfter: '0.01', body: { error: { message: 'tpm' } } }, ok(planJson)] });
  const res = await llmFor(fake).run('plan', config);
  assert.equal(res.model, 'big');
  assert.deepEqual(fake.calls, ['big', 'big']);
});

test('malformed output moves to the next model; a bad key stops immediately', async () => {
  const fake = fakeGroq({ big: [ok('not json at all')], small: [ok(planJson)] });
  assert.equal((await llmFor(fake).run('plan', config)).model, 'small');

  const denied = fakeGroq({ big: [{ status: 401, body: { error: { message: 'invalid api key' } } }] });
  await assert.rejects(llmFor(denied).run('plan', config), /rejected the API key/);
  assert.deepEqual(denied.calls, ['big']);
});

test('quota readings survive a restart through the store', async () => {
  const store = memoryStore();
  await llmFor(fakeGroq({ big: [ok(planJson, 1234)] }), store).run('plan', config);
  const quota = createQuota(store);
  assert.deepEqual(quota.snapshot(['big'])[0].usedToday, { requests: 1, tokens: 1234 });
});
