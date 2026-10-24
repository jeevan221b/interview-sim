import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createAuth } from '../src/auth.js';

const TEAM = 'me.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const TOKEN = 'x'.repeat(32);

async function setup(modes) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const auth = createAuth(
    { modes, accessToken: TOKEN, cfTeamDomain: TEAM, cfAud: AUD, adminEmails: ['owner@example.com'], allowedEmails: [] },
    { jwks: createLocalJWKSet({ keys: [jwk] }) },
  );
  const app = new Hono();
  app.use('*', auth.middleware);
  app.get('/x', (c) => c.json(c.get('identity')));
  const sign = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts.issuer ?? `https://${TEAM}`)
      .setAudience(opts.audience ?? AUD)
      .setExpirationTime(opts.exp ?? '5m')
      .sign(opts.key ?? privateKey);
  return { app, sign };
}

const get = (app, headers = {}) => app.request('/x', { headers });

test('cloudflare: a valid token identifies the user (access is decided later by the users table)', async () => {
  const { app, sign } = await setup(['cloudflare']);
  const res = await get(app, { 'cf-access-jwt-assertion': await sign({ email: 'Me@Example.com' }) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { email: 'me@example.com', via: 'cloudflare' });
});

test('cloudflare: rejects missing, emailless, wrong-audience, wrong-issuer and foreign-key tokens', async () => {
  const { app, sign } = await setup(['cloudflare']);
  const other = await generateKeyPair('RS256');
  const bad = [
    undefined,
    await sign({ sub: 'service-token' }),
    await sign({ email: 'me@example.com' }, { audience: 'other-app' }),
    await sign({ email: 'me@example.com' }, { issuer: 'https://evil.cloudflareaccess.com' }),
    await sign({ email: 'me@example.com' }, { key: other.privateKey }),
    await sign({ email: 'me@example.com' }, { exp: Math.floor(Date.now() / 1000) - 60 }),
  ];
  for (const jwt of bad) {
    const res = await get(app, jwt ? { 'cf-access-jwt-assertion': jwt } : {});
    assert.equal(res.status, 401);
  }
});

test('token: bearer token signs in as the first admin, wrong token fails', async () => {
  const { app } = await setup(['token']);
  const ok = await get(app, { authorization: `Bearer ${TOKEN}` });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { email: 'owner@example.com', via: 'token' });
  assert.equal((await get(app, { authorization: `Bearer ${'y'.repeat(32)}` })).status, 401);
  assert.equal((await get(app)).status, 401);
});

test('cloudflare,token: an invalid Cloudflare token does not fall back to token auth', async () => {
  const { app, sign } = await setup(['cloudflare', 'token']);
  const res = await get(app, {
    'cf-access-jwt-assertion': await sign({ email: 'me@example.com' }, { audience: 'other-app' }),
    authorization: `Bearer ${TOKEN}`,
  });
  assert.equal(res.status, 401);
  assert.equal((await get(app, { authorization: `Bearer ${TOKEN}` })).status, 200);
});

test('misconfiguration fails at startup instead of leaving the app open', () => {
  const admins = ['owner@example.com'];
  assert.throws(() => createAuth({ modes: ['token'], accessToken: 'short', adminEmails: admins }));
  assert.throws(() => createAuth({ modes: ['token'], accessToken: TOKEN, adminEmails: [] }), /ADMIN_EMAILS/);
  assert.throws(() => createAuth({ modes: ['cloudflare'], accessToken: '', cfTeamDomain: TEAM, cfAud: '', adminEmails: admins }));
});

test('none: dev identity is the first admin, X-Dev-User can impersonate locally', async () => {
  const auth = createAuth({ modes: ['none'], adminEmails: ['owner@example.com'] });
  const app = new Hono();
  app.use('*', auth.middleware);
  app.get('/x', (c) => c.json(c.get('identity')));
  assert.deepEqual(await (await get(app)).json(), { email: 'owner@example.com', via: 'dev' });
  assert.deepEqual(await (await get(app, { 'x-dev-user': 'Friend@Example.com' })).json(), { email: 'friend@example.com', via: 'dev' });
  assert.equal((await (await get(app, { 'x-dev-user': 'not an email' })).json()).email, 'owner@example.com');
});
