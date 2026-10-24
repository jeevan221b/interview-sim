import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createLlm } from '../src/llm/index.js';

const OWNER = 'owner@example.com';
const FRIEND = 'friend@example.com';

function makeApp(env = {}) {
  const config = loadConfig({ DB_PATH: ':memory:', WEB_DIST: '/nonexistent', ADMIN_EMAILS: OWNER, DAILY_AI_LIMIT: '20', ...env });
  const db = openDb(':memory:');
  const llm = createLlm({ ...config.llm, providers: ['mock'] }, { log: { warn() {} } });
  return { app: createApp({ config, db, llm }), db };
}

// AUTH_MODE=none: X-Dev-User picks who is calling.
const as = (app, email) => async (method, path, body) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(email ? { 'x-dev-user': email } : {}) },
    body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

test('uninvited users are turned away until the admin invites them', async () => {
  const { app } = makeApp();
  const friend = as(app, FRIEND);
  const denied = await friend('GET', '/api/me');
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'not_invited');
  assert.equal(denied.body.email, FRIEND);

  const owner = as(app, OWNER);
  const me = await owner('GET', '/api/me');
  assert.equal(me.body.isAdmin, true);
  assert.equal(me.body.usage.limit, null, 'admins have no daily limit');

  assert.equal((await owner('POST', '/api/admin/users', { email: 'Friend@Example.com', name: 'Friend' })).status, 201);
  assert.equal((await owner('POST', '/api/admin/users', { email: FRIEND })).status, 409);
  assert.equal((await owner('POST', '/api/admin/users', { email: 'nope' })).status, 400);

  const now = await friend('GET', '/api/me');
  assert.equal(now.status, 200);
  assert.equal(now.body.isAdmin, false);
  assert.deepEqual([now.body.usage.used, now.body.usage.limit], [0, 20]);

  // Pausing access works; the config admin cannot be paused or removed.
  await owner('PATCH', `/api/admin/users/${FRIEND}`, { status: 'disabled' });
  assert.equal((await friend('GET', '/api/me')).body.code, 'disabled');
  assert.equal((await owner('PATCH', `/api/admin/users/${OWNER}`, { status: 'disabled' })).status, 400);
  assert.equal((await owner('DELETE', `/api/admin/users/${OWNER}`)).status, 400);
});

test('interviews, stats and topics are private to each user', async () => {
  const { app } = makeApp({ ALLOWED_EMAILS: FRIEND });
  const owner = as(app, OWNER);
  const friend = as(app, FRIEND);
  // ALLOWED_EMAILS is seeded at startup by index.js (not createApp), so invite here.
  await owner('POST', '/api/admin/users', { email: FRIEND });

  const mine = await owner('POST', '/api/sessions', { topic: 'Power Systems', questionCount: 3 });
  assert.equal(mine.status, 201);
  assert.equal((await friend('GET', `/api/sessions/${mine.body.id}`)).status, 404);
  assert.equal((await friend('DELETE', `/api/sessions/${mine.body.id}`)).status, 404);
  assert.equal((await friend('POST', `/api/sessions/${mine.body.id}/finish`)).status, 404);
  assert.equal((await friend('GET', '/api/sessions')).body.length, 0);
  assert.equal((await owner('GET', '/api/sessions')).body.length, 1);
  assert.equal((await friend('GET', '/api/stats')).body.totalSessions, 0);

  await owner('POST', '/api/topics', { name: 'Cardiology', field: 'Medical & Healthcare', focus: 'ECG' });
  await friend('POST', '/api/topics', { topics: [{ name: 'Contract Law', field: 'Law' }, { name: 'Surveying', field: 'Civil' }] });
  assert.deepEqual((await owner('GET', '/api/topics')).body.map((t) => t.name), ['Cardiology']);
  assert.equal((await friend('GET', '/api/topics')).body.length, 2);
  assert.equal((await friend('DELETE', `/api/topics/${encodeURIComponent('Contract Law')}`)).body.length, 1);
});

test('admin-only areas are closed to regular users', async () => {
  const { app } = makeApp();
  const owner = as(app, OWNER);
  await owner('POST', '/api/admin/users', { email: FRIEND });
  const friend = as(app, FRIEND);
  for (const [m, p] of [['GET', '/api/admin/users'], ['GET', '/api/quota'], ['POST', '/api/quota/refresh'], ['PATCH', `/api/admin/users/${FRIEND}`]]) {
    assert.equal((await friend(m, p, {})).status, 403, `${m} ${p}`);
  }
  const meta = await friend('GET', '/api/meta');
  assert.equal(meta.body.providers, undefined);
  assert.equal(typeof meta.body.mockOnly, 'boolean');
  assert.ok((await owner('GET', '/api/meta')).body.providers);
});

test('daily AI limit blocks new interviews but never strands one in progress', async () => {
  const { app } = makeApp();
  const owner = as(app, OWNER);
  await owner('POST', '/api/admin/users', { email: FRIEND, dailyLimit: 6 });
  const friend = as(app, FRIEND);

  // 3 questions graded each time with follow-ups ≈ 2 + 3 + 2 = 7 > 6.
  const tooBig = await friend('POST', '/api/sessions', { topic: 'Python', questionCount: 3 });
  assert.equal(tooBig.status, 429);
  assert.equal(tooBig.body.code, 'daily_limit');

  // Grading at the end ≈ 2 + 1 = 3 fits.
  const s = (await friend('POST', '/api/sessions', { topic: 'Python', questionCount: 3, grading: 'end' })).body;
  for (const q of s.questions) await friend('POST', `/api/sessions/${s.id}/questions/${q.id}/answer`, { transcript: 'Generators are lazy iterators.' });
  await owner('PATCH', `/api/admin/users/${FRIEND}`, { dailyLimit: 1 });
  // Over the (lowered) limit now, but finishing the started interview still works.
  const done = await friend('POST', `/api/sessions/${s.id}/finish`);
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'completed');

  const usage = (await friend('GET', '/api/me')).body.usage;
  assert.equal(usage.used, 3, 'plan + 1 batch + review');
  const users = (await owner('GET', '/api/admin/users')).body.users;
  const f = users.find((u) => u.email === FRIEND);
  assert.equal(f.usedToday, 3);
  assert.equal(f.stats.completed, 1);
  assert.equal((await friend('POST', '/api/sessions', { topic: 'Python', questionCount: 3, grading: 'end' })).status, 429);
});

test('removing a user can also delete their data', async () => {
  const { app, db } = makeApp();
  const owner = as(app, OWNER);
  await owner('POST', '/api/admin/users', { email: FRIEND });
  const friend = as(app, FRIEND);
  await friend('POST', '/api/sessions', { topic: 'SQL', questionCount: 3, grading: 'end' });
  await friend('POST', '/api/topics', { name: 'Tally', field: 'Business & Management' });
  assert.equal((await owner('DELETE', `/api/admin/users/${FRIEND}?deleteData=1`)).status, 200);
  assert.equal(db.list(FRIEND).length, 0);
  assert.equal(db.topics.list(FRIEND).length, 0);
  assert.equal((await friend('GET', '/api/me')).status, 403);
});

test('sessions from the single-user version are handed to the owner', () => {
  const db = openDb(':memory:');
  db.create({ id: 'old', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', status: 'completed', config: { topic: 'React' } }, null);
  assert.equal(db.claimOrphans(OWNER), 1);
  assert.equal(db.get('old', OWNER).id, 'old');
  assert.equal(db.get('old', FRIEND), null);
});

test('admin sees sign-ins, online status, turned-away attempts and AI usage per person', async () => {
  const { app, db } = makeApp();
  const owner = as(app, OWNER);
  await owner('POST', '/api/admin/users', { email: FRIEND, name: 'Friend' });
  const friend = as(app, FRIEND);
  await friend('GET', '/api/me');
  await friend('POST', '/api/sessions', { topic: 'SQL', questionCount: 3, grading: 'end' });
  db.usage.add(FRIEND, 2, 1500); // as if two real Groq calls had reported tokens
  await as(app, 'stranger@example.com')('GET', '/api/me');

  const list = (await owner('GET', '/api/admin/users')).body.users;
  const f = list.find((u) => u.email === FRIEND);
  assert.equal(f.online, true);
  assert.equal(f.signIns, 1);
  assert.ok(f.firstSeenAt && f.lastVisit);
  assert.equal(f.lastVisit.via, 'dev');
  assert.deepEqual(f.usage.today, { requests: 3, tokens: 1500 });
  assert.deepEqual(f.usage.total, { requests: 3, tokens: 1500 });
  assert.equal(f.stats.inProgress, 1);
  assert.equal(list.find((u) => u.email === OWNER).online, true);

  const detail = (await owner('GET', `/api/admin/users/${FRIEND}`)).body;
  assert.equal(detail.visits.length, 1);
  assert.equal(detail.daily.length, 30);
  assert.equal(detail.daily.at(-1).requests, 3);
  assert.deepEqual(Object.keys(detail.sessions[0]).sort(), ['createdAt', 'id', 'overallScore', 'status', 'topic']);

  const events = (await owner('GET', '/api/admin/activity')).body.events;
  assert.ok(events.some((e) => e.kind === 'not_invited' && e.email === 'stranger@example.com'));
  assert.ok(events.some((e) => e.kind === 'visit' && e.email === FRIEND));

  for (const path of [`/api/admin/users/${FRIEND}`, '/api/admin/activity']) assert.equal((await friend('GET', path)).status, 403);
});

test('a long gap starts a new visit; activity within it extends the current one', () => {
  const db = openDb(':memory:');
  const t0 = new Date('2026-10-24T10:00:00Z');
  db.visits.record(FRIEND, { via: 'cloudflare' }, t0);
  db.visits.record(FRIEND, {}, new Date(t0.getTime() + 20 * 60_000));
  db.visits.record(FRIEND, {}, new Date(t0.getTime() + 75 * 60_000));
  const visits = db.visits.forUser(FRIEND);
  assert.equal(visits.length, 2);
  assert.equal(visits[1].lastAt, '2026-10-24T10:20:00.000Z');
});

test('the local placeholder admin can be merged into the real owner', () => {
  const db = openDb(':memory:');
  db.users.ensureAdmin('admin@localhost');
  db.create({ id: 's1', createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z', status: 'completed', config: { topic: 'React' } }, 'admin@localhost');
  db.topics.upsert('admin@localhost', { name: 'Cardiology', field: 'Medical & Healthcare', focus: '' });
  assert.equal(db.mergeUser('admin@localhost', OWNER), 1);
  assert.equal(db.get('s1', OWNER).id, 's1');
  assert.deepEqual(db.topics.list(OWNER).map((t) => t.name), ['Cardiology']);
  assert.equal(db.users.get('admin@localhost'), null);
});
