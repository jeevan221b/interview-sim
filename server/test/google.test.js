import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createLlm } from '../src/llm/index.js';

const CLIENT_ID = '1234-abc.apps.googleusercontent.com';
const OWNER = 'owner@example.com';
const FRIEND = 'friend@example.com';
const HOST = { host: 'interview.example.com' };

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'g1', alg: 'RS256' };
  const config = loadConfig({
    DB_PATH: ':memory:',
    WEB_DIST: '/nonexistent',
    AUTH_MODE: 'google',
    GOOGLE_CLIENT_ID: CLIENT_ID,
    ADMIN_EMAILS: OWNER,
  });
  const db = openDb(':memory:');
  const llm = createLlm({ ...config.llm, providers: ['mock'] }, { log: { warn() {} } });
  const app = createApp({ config, db, llm, authDeps: { googleJwks: createLocalJWKSet({ keys: [jwk] }) } });
  /** A Google ID token as Google Identity Services would hand it to the browser. */
  const credential = (claims, opts = {}) =>
    new SignJWT({ email_verified: true, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'g1' })
      .setIssuer(opts.issuer ?? 'https://accounts.google.com')
      .setAudience(opts.audience ?? CLIENT_ID)
      .setExpirationTime(opts.exp ?? '5m')
      .sign(opts.key ?? privateKey);
  const signIn = (cred) =>
    app.request('/api/auth/google', {
      method: 'POST',
      headers: { ...HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ credential: cred }),
    });
  const cookieOf = (res) => res.headers.get('set-cookie')?.split(';')[0];
  const get = (path, cookie) => app.request(path, { headers: { ...HOST, ...(cookie ? { cookie } : {}) } });
  return { app, db, credential, signIn, cookieOf, get };
}

test('google: public config exposes the client ID, everything else needs a session', async () => {
  const { get } = await setup();
  assert.deepEqual(await (await get('/api/auth/config')).json(), { modes: ['google'], googleClientId: CLIENT_ID });
  assert.equal((await get('/api/me')).status, 401);
});

test('google: the admin signs in and gets a secure, http-only session cookie', async () => {
  const { credential, signIn, cookieOf, get } = await setup();
  const res = await signIn(await credential({ email: 'Owner@Example.com', name: 'Owner' }));
  assert.equal(res.status, 200);
  const header = res.headers.get('set-cookie');
  assert.match(header, /isim_session=/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
  const me = await (await get('/api/me', cookieOf(res))).json();
  assert.equal(me.email, OWNER);
  assert.equal(me.isAdmin, true);
  assert.equal(me.via, 'google');
});

test('google: an uninvited account is identified but turned away until invited', async () => {
  const { db, credential, signIn, cookieOf, get } = await setup();
  const cookie = cookieOf(await signIn(await credential({ email: FRIEND, name: 'Friend' })));
  const denied = await get('/api/me', cookie);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: "You haven't been invited to this app yet.", code: 'not_invited', email: FRIEND, via: 'google' });

  db.users.add({ email: FRIEND });
  const me = await (await get('/api/me', cookie)).json();
  assert.equal(me.isAdmin, false, 'invited users are never admins');
  assert.equal((await get('/api/admin/users', cookie)).status, 403);
});

test('google: signing in fills in a missing name for an invited user', async () => {
  const { db, credential, signIn } = await setup();
  db.users.add({ email: FRIEND });
  await signIn(await credential({ email: FRIEND, name: 'Friend Person' }));
  assert.equal(db.users.get(FRIEND).name, 'Friend Person');
});

test('google: rejects unverified, wrong-audience, wrong-issuer, foreign-key and expired credentials', async () => {
  const { credential, signIn } = await setup();
  const other = await generateKeyPair('RS256');
  const bad = [
    'not-a-jwt',
    await credential({ email: OWNER, email_verified: false }),
    await credential({ sub: '123' }),
    await credential({ email: OWNER }, { audience: 'other.apps.googleusercontent.com' }),
    await credential({ email: OWNER }, { issuer: 'https://evil.example.com' }),
    await credential({ email: OWNER }, { key: other.privateKey }),
    await credential({ email: OWNER }, { exp: Math.floor(Date.now() / 1000) - 60 }),
  ];
  for (const cred of bad) {
    const res = await signIn(cred);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('set-cookie'), null);
  }
});

test('google: forged or tampered session cookies are rejected', async () => {
  const { credential, signIn, cookieOf, get } = await setup();
  const cookie = cookieOf(await signIn(await credential({ email: FRIEND })));
  const forged = await new SignJWT({ email: OWNER })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('interview-sim')
    .setAudience('session')
    .setExpirationTime('1d')
    .sign(new Uint8Array(32).fill(7));
  assert.equal((await get('/api/me', `isim_session=${forged}`)).status, 401);
  assert.equal((await get('/api/me', `${cookie}x`)).status, 401);
});

test('google: logout clears the session cookie', async () => {
  const { app } = await setup();
  const res = await app.request('/api/auth/logout', { method: 'POST', headers: HOST });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /isim_session=;.*Max-Age=0/);
});

test('google: sign-in attempts are rate limited per IP', async () => {
  const { app } = await setup();
  const attempt = () =>
    app.request('/api/auth/google', {
      method: 'POST',
      headers: { ...HOST, 'cf-connecting-ip': '203.0.113.9', 'content-type': 'application/json' },
      body: '{}',
    });
  for (let i = 0; i < 10; i++) assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 429);
});

test('google: misconfiguration fails at startup', () => {
  const secret = new Uint8Array(32);
  const base = { modes: ['google'], adminEmails: [OWNER] };
  assert.throws(() => createAuth({ ...base, googleClientId: '' }, { sessionSecret: secret }), /GOOGLE_CLIENT_ID/);
  assert.throws(() => createAuth({ ...base, googleClientId: 'my-app' }, { sessionSecret: secret }), /GOOGLE_CLIENT_ID/);
  assert.throws(() => createAuth({ ...base, googleClientId: CLIENT_ID }, {}), /session secret/);
  assert.throws(() => createAuth({ ...base, adminEmails: [], googleClientId: CLIENT_ID }, { sessionSecret: secret }), /ADMIN_EMAILS/);
});

test('session secret survives restarts (same database)', async () => {
  const db = openDb(':memory:');
  const config = loadConfig({ DB_PATH: ':memory:', WEB_DIST: '/nonexistent', ADMIN_EMAILS: OWNER });
  const llm = createLlm({ ...config.llm, providers: ['mock'] }, { log: { warn() {} } });
  createApp({ config, db, llm });
  const first = db.kv.get('session_secret');
  createApp({ config, db, llm });
  assert.equal(db.kv.get('session_secret'), first);
  assert.equal(first.length, 64);
});
