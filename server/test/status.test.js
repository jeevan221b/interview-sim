import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createLlm } from '../src/llm/index.js';

const KEY = 'k'.repeat(32);
const OWNER = 'owner@example.com';
const FRIEND = 'friend@example.com';

function makeApp(env = {}) {
  const config = loadConfig({ DB_PATH: ':memory:', WEB_DIST: '/nonexistent', ADMIN_EMAILS: OWNER, STATUS_KEY: KEY, ...env });
  const db = openDb(':memory:');
  const llm = createLlm({ ...config.llm, providers: ['mock'] }, { log: { warn() {} } });
  return { app: createApp({ config, db, llm }), db };
}

const status = (app, key) => app.request('/api/status', { headers: key ? { 'x-status-key': key } : {} });

test('status: hidden without the right key, or when no key is configured', async () => {
  const { app } = makeApp();
  assert.equal((await status(app)).status, 404);
  assert.equal((await status(app, 'x'.repeat(32))).status, 404);
  const { app: noKey } = makeApp({ STATUS_KEY: '' });
  assert.equal((await status(noKey, '')).status, 404);
  const { app: shortKey } = makeApp({ STATUS_KEY: 'short' });
  assert.equal((await status(shortKey, 'short')).status, 404);
});

test('status: counts people, who is online and live interviews, without any emails or content', async () => {
  const { app, db } = makeApp();
  db.users.add({ email: FRIEND, name: 'Friend Person' });
  // The owner uses the app and starts an interview (AUTH_MODE=none: dev identity is the owner).
  await app.request('/api/me');
  const created = await app.request('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: 'Secret Topic Name', questionCount: 3 }),
  });
  assert.equal(created.status, 201);

  const res = await status(app, KEY);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.people, 2);
  assert.equal(body.online_now, 1);
  assert.equal(body.live_interviews, 1);
  assert.equal(body.interviews_today, 1);
  assert.equal(body.completed_today, 0);
  const text = JSON.stringify(body);
  for (const secret of ['example.com', 'Friend Person', 'Secret Topic']) assert.ok(!text.includes(secret), secret);
});
