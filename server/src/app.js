import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { EMAIL_RE, SESSION_COOKIE, SESSION_MAX_AGE, createAuth } from './auth.js';
import { daysAgo, today } from './db.js';
import {
  HttpError,
  answerQuestion,
  computeStats,
  createSession,
  estimateCalls,
  finishSession,
  generateModelAnswer,
  parseConfig,
  summarizeSession,
  weakQuestions,
} from './interview.js';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
// Seen within this window counts as "online now" (the web app pings every minute while open).
const ONLINE_MS = 3 * 60_000;

/** Where a request came from, for the admin's sign-in history. Cloudflare sets cf-connecting-ip. */
function clientInfo(c) {
  let ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null;
  if (!ip) {
    try {
      ip = getConnInfo(c).remote.address || null;
    } catch {
      /* not a real socket (tests) */
    }
  }
  return { ip, userAgent: (c.req.header('user-agent') || '').slice(0, 300) || null };
}

/** Fixed-window limiter for the routes that spend AI quota (and sign-in, keyed by IP). */
function rateLimit(perMinute) {
  const hits = new Map();
  return async (c, next) => {
    const key = c.get('user')?.email || clientInfo(c).ip || 'local';
    const window = Math.floor(Date.now() / 60_000);
    const entry = hits.get(key);
    const count = entry?.window === window ? entry.count + 1 : 1;
    hits.set(key, { window, count });
    if (count > perMinute) return c.json({ error: 'Too many AI requests. Wait a minute and try again.' }, 429);
    return next();
  };
}

/**
 * @param {{ config: ReturnType<import('./config.js').loadConfig>, db: ReturnType<import('./db.js').openDb>,
 *   llm: ReturnType<import('./llm/index.js').createLlm>, authDeps?: any, onActivity?: () => void, fetchImpl?: typeof fetch }} deps
 */
export function createApp({ config, db, llm, authDeps, onActivity = () => {}, fetchImpl = fetch }) {
  const app = new Hono();
  // Signs google-mode session cookies; kept in the database so restarts don't sign everyone out.
  let secret = db.kv.get('session_secret');
  if (!secret) db.kv.set('session_secret', (secret = randomBytes(32).toString('hex')));
  const auth = createAuth(config.auth, { sessionSecret: Buffer.from(secret, 'hex'), ...authDeps });
  const limited = rateLimit(config.aiRateLimitPerMin);
  const whisper = !!config.llm.groq.apiKey;

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, ...err.extra }, err.status);
    console.error('[server]', err);
    return c.json({ error: err.message || 'internal error' }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  const admins = new Set(config.auth.adminEmails);
  const touched = new Map();
  const deniedLogged = new Map();

  // ---------- sign-in (public: these run before the auth middleware) ----------

  // Plain http is only ever localhost; everywhere else the app sits behind Cloudflare's https.
  const cookieOpts = (c) => ({
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(c.req.header('host') || ''),
  });

  app.get('/api/auth/config', (c) => c.json({ modes: auth.modes, googleClientId: auth.google?.clientId || null }));

  if (auth.google) {
    app.post('/api/auth/google', rateLimit(10), async (c) => {
      const { credential } = await c.req.json().catch(() => ({}));
      const who = typeof credential === 'string' ? await auth.google.verifyCredential(credential) : null;
      if (!who) throw new HttpError(401, 'Google sign-in could not be verified. Try again.');
      // Fill in the name for invited users who don't have one yet; access itself is checked per request.
      const user = db.users.get(who.email);
      if (user && !user.name && who.name) db.users.update(who.email, { name: who.name.slice(0, 80), status: user.status, dailyLimit: user.dailyLimit });
      setCookie(c, SESSION_COOKIE, await auth.google.issueSession(who.email), { ...cookieOpts(c), maxAge: SESSION_MAX_AGE });
      return c.json({ email: who.email });
    });
  }

  app.post('/api/auth/logout', async (c) => {
    const session = getCookie(c, SESSION_COOKIE);
    const email = session && auth.google ? await auth.google.readSession(session) : null;
    if (email && db.users.get(email)) {
      // Recorded so the admin page shows them offline now, not 3 minutes later.
      db.users.signOut(email);
      db.visits.signOut(email);
      touched.delete(email);
    }
    deleteCookie(c, SESSION_COOKIE, cookieOpts(c));
    return c.json({ ok: true });
  });


  // Authorization: the authenticated email must be an admin or an invited, active user.
  app.use('/api/*', auth.middleware, async (c, next) => {
    const { email, via } = c.get('identity');
    // With no ADMIN_EMAILS (fresh local setup) the default dev identity is the admin.
    if (admins.has(email) || (via === 'dev' && !admins.size && email === 'admin@localhost')) db.users.ensureAdmin(email);
    const user = db.users.get(email);
    if (!user || user.status !== 'active') {
      const reason = user ? 'disabled' : 'not_invited';
      // Shown to the admin as "turned away"; one entry per person per 10 minutes is enough.
      if (Date.now() - (deniedLogged.get(`${email}|${reason}`) || 0) > 10 * 60_000) {
        deniedLogged.set(`${email}|${reason}`, Date.now());
        db.denied.record(email, reason, { via, ...clientInfo(c) });
      }
      return c.json(
        user
          ? { error: 'Your access to this app has been paused.', code: 'disabled', email, via }
          : { error: "You haven't been invited to this app yet.", code: 'not_invited', email, via },
        403,
      );
    }
    // last_seen and visits are for the admin page; once a minute per user is plenty.
    if (Date.now() - (touched.get(email) || 0) > 50_000) {
      touched.set(email, Date.now());
      db.users.touch(email);
      db.visits.record(email, { via, ...clientInfo(c) });
    }
    c.set('user', { ...user, isAdmin: user.role === 'admin', via });
    onActivity();
    return next();
  });

  const me = (c) => c.get('user');
  const adminOnly = async (c, next) => (me(c).isAdmin ? next() : c.json({ error: 'admin only', code: 'forbidden' }, 403));

  const load = (c, id) => {
    const session = db.get(id, me(c).email);
    if (!session) throw new HttpError(404, 'session not found');
    return session;
  };

  // ---------- daily AI allowance ----------

  const limitFor = (user) => (user.role === 'admin' ? null : (user.dailyLimit ?? config.dailyAiLimit));
  const usageFor = (user) => {
    const limit = limitFor(user);
    const used = db.usage.get(user.email);
    return { used, limit, remaining: limit === null ? null : Math.max(0, limit - used), day: today() };
  };
  const requireAllowance = (user, needed) => {
    const { used, limit } = usageFor(user);
    if (limit !== null && used + needed > limit) {
      const left = Math.max(0, limit - used);
      throw new HttpError(
        429,
        needed > 1
          ? `This interview needs about ${needed} AI requests and you have ${left} left today (daily limit ${limit}). Try grading at the end or fewer questions, or come back tomorrow.`
          : `You've used today's ${limit} AI requests. They reset at midnight.`,
        { code: 'daily_limit', used, limit },
      );
    }
  };
  /** The shared LLM, counting each successful AI request against the caller's day. */
  const llmFor = (c) => ({
    async run(task, input) {
      const result = await llm.run(task, input);
      db.usage.add(me(c).email, 1, result.tokens || 0);
      return result;
    },
  });

  // ---------- me / meta ----------

  app.get('/api/me', (c) => {
    const u = me(c);
    return c.json({
      email: u.email,
      name: u.name,
      role: u.role,
      isAdmin: u.isAdmin,
      via: u.via,
      usage: usageFor(u),
      logoutUrl: u.via === 'cloudflare' ? '/cdn-cgi/access/logout' : null,
      devMode: auth.mode === 'none',
    });
  });

  app.get('/api/meta', (c) => {
    const base = { whisper, authMode: auth.mode, mockOnly: llm.providers.every((p) => p.name === 'mock') };
    return c.json(me(c).isAdmin ? { ...base, providers: llm.providers } : base);
  });

  // ---------- sessions (always scoped to the caller) ----------

  app.get('/api/stats', (c) => c.json(computeStats(db.list(me(c).email))));

  app.get('/api/sessions', (c) => c.json(db.list(me(c).email, Number(c.req.query('limit')) || 200).map(summarizeSession)));

  app.post('/api/sessions', limited, async (c) => {
    const config = parseConfig(await c.req.json().catch(() => ({})));
    requireAllowance(me(c), estimateCalls(config));
    const { data, provider } = await llmFor(c).run('plan', config);
    return c.json(db.create(createSession(config, data, provider), me(c).email), 201);
  });

  // Practice session built from earlier answers that scored below 6.
  app.post('/api/sessions/weak', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const weak = weakQuestions(db.list(me(c).email)).slice(0, Math.min(10, Number(body.limit) || 5));
    if (!weak.length) throw new HttpError(404, 'No weak answers yet. Finish a few interviews first.');
    const config = parseConfig({ ...body, topic: 'Weak spots', type: 'mixed', questionCount: weak.length });
    requireAllowance(me(c), estimateCalls(config) - 1);
    return c.json(db.create(createSession(config, weak, 'history'), me(c).email), 201);
  });

  app.get('/api/sessions/:id', (c) => c.json(load(c, c.req.param('id'))));

  app.delete('/api/sessions/:id', (c) => {
    if (!db.remove(c.req.param('id'), me(c).email)) throw new HttpError(404, 'session not found');
    return c.json({ ok: true });
  });

  // Answers and finishing were budgeted when the interview started, so they aren't
  // blocked by the daily limit (an interview never gets stuck half way).
  app.post('/api/sessions/:id/questions/:qid/answer', limited, async (c) => {
    const session = load(c, c.req.param('id'));
    const result = await answerQuestion(session, c.req.param('qid'), await c.req.json().catch(() => ({})), llmFor(c));
    db.save(session);
    return c.json({ ...result, session });
  });

  app.post('/api/sessions/:id/finish', limited, async (c) => {
    const session = await finishSession(load(c, c.req.param('id')), llmFor(c), (s) => db.save(s));
    return c.json(db.save(session));
  });

  app.post('/api/sessions/:id/questions/:qid/model-answer', limited, async (c) => {
    const session = load(c, c.req.param('id'));
    const question = session.questions.find((q) => q.id === c.req.param('qid'));
    if (question && !question.evaluation?.modelAnswer) requireAllowance(me(c), 1);
    await generateModelAnswer(session, c.req.param('qid'), llmFor(c));
    db.save(session);
    return c.json({ question: session.questions.find((q) => q.id === c.req.param('qid')), session });
  });

  // ---------- custom topics ----------

  const topicBody = (b = {}) => {
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 100) : '';
    if (name.length < 2) throw new HttpError(400, 'topic name is required');
    return {
      name,
      field: typeof b.field === 'string' ? b.field.trim().slice(0, 60) : '',
      focus: typeof b.focus === 'string' ? b.focus.trim().slice(0, 400) : '',
      type: ['technical', 'behavioral', 'mixed'].includes(b.type) ? b.type : undefined,
    };
  };

  app.get('/api/topics', (c) => c.json(db.topics.list(me(c).email)));

  app.post('/api/topics', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    // `topics: [...]` imports several at once (moving topics saved in the browser to the server).
    const items = Array.isArray(body.topics) ? body.topics.slice(0, 40).map(topicBody) : [topicBody(body)];
    for (const t of items) db.topics.upsert(me(c).email, t);
    return c.json(db.topics.list(me(c).email));
  });

  app.delete('/api/topics/:name', (c) => {
    db.topics.remove(me(c).email, c.req.param('name'));
    return c.json(db.topics.list(me(c).email));
  });

  // ---------- admin ----------

  app.use('/api/admin/*', adminOnly);
  app.use('/api/quota', adminOnly);
  app.use('/api/quota/*', adminOnly);

  app.get('/api/quota', (c) => c.json(llm.quota() ?? { provider: null, models: [] }));

  // Spends one tiny request per model to get fresh limit headers.
  app.post('/api/quota/refresh', limited, async (c) => c.json((await llm.refreshQuota()) ?? { provider: null, models: [] }));

  const zero = { requests: 0, tokens: 0 };
  const adminView = () => {
    const stats = db.statsByUser();
    const usage = db.usage.summary();
    const visits = db.visits.summary();
    const latest = db.visits.latest();
    const now = Date.now();
    return db.users.list().map((u) => {
      const use = usage[u.email] || {};
      return {
        ...u,
        locked: admins.has(u.email),
        online:
          u.status === 'active' &&
          !!u.lastSeenAt &&
          now - Date.parse(u.lastSeenAt) < ONLINE_MS &&
          !(u.signedOutAt && u.signedOutAt >= u.lastSeenAt),
        effectiveLimit: limitFor(u),
        usedToday: use.today?.requests || 0,
        usage: { today: use.today || zero, week: use.week || zero, month: use.month || zero, total: use.total || zero },
        signIns: visits[u.email]?.visits || 0,
        firstSeenAt: visits[u.email]?.firstAt || null,
        lastVisit: latest[u.email] || null,
        stats: stats[u.email] || { sessions: 0, completed: 0, inProgress: 0, avgScore: null, bestScore: null, lastSessionAt: null },
      };
    });
  };

  const limitValue = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > 10_000) throw new HttpError(400, 'daily limit must be between 0 and 10000');
    return n;
  };

  app.get('/api/admin/users', (c) => c.json({ users: adminView(), defaultLimit: config.dailyAiLimit, day: today(), onlineWindowMin: ONLINE_MS / 60_000 }));

  // One person's sign-in history, 30-day AI usage and interview list (metadata only, no answers).
  app.get('/api/admin/users/:email', (c) => {
    const email = c.req.param('email').toLowerCase();
    const user = adminView().find((u) => u.email === email);
    if (!user) throw new HttpError(404, 'user not found');
    return c.json({ user, visits: db.visits.forUser(email, 50), daily: db.usage.daily(email, 30), sessions: db.sessionsMeta(email, 20) });
  });

  // Everyone's recent sign-ins plus turned-away attempts, newest first.
  app.get('/api/admin/activity', (c) => {
    const events = [
      ...db.visits.recent(60).map((v) => ({ kind: 'visit', email: v.email, at: v.startedAt, lastAt: v.lastAt, signedOutAt: v.signedOutAt, via: v.via, ip: v.ip, userAgent: v.userAgent })),
      ...db.denied.recent(60).map((d) => ({ kind: d.reason, email: d.email, at: d.at, lastAt: d.at, via: d.via, ip: d.ip, userAgent: d.userAgent })),
    ].sort((x, y) => (x.at < y.at ? 1 : -1));
    return c.json({ events: events.slice(0, 60), since: daysAgo(30) });
  });

  app.post('/api/admin/users', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'enter a valid email address');
    const added = db.users.add({
      email,
      name: String(body.name || '').trim().slice(0, 80),
      dailyLimit: limitValue(body.dailyLimit),
      addedBy: me(c).email,
    });
    if (!added) throw new HttpError(409, `${email} already has access`);
    return c.json({ users: adminView() }, 201);
  });

  app.patch('/api/admin/users/:email', async (c) => {
    const email = c.req.param('email').toLowerCase();
    const user = db.users.get(email);
    if (!user) throw new HttpError(404, 'user not found');
    const body = await c.req.json().catch(() => ({}));
    const status = body.status === undefined ? user.status : body.status;
    if (!['active', 'disabled'].includes(status)) throw new HttpError(400, 'status must be active or disabled');
    if (admins.has(email) && status !== 'active') throw new HttpError(400, 'admins from ADMIN_EMAILS cannot be disabled');
    db.users.update(email, {
      name: body.name === undefined ? user.name : String(body.name).trim().slice(0, 80),
      status,
      dailyLimit: body.dailyLimit === undefined ? user.dailyLimit : limitValue(body.dailyLimit),
    });
    return c.json({ users: adminView() });
  });

  app.delete('/api/admin/users/:email', (c) => {
    const email = c.req.param('email').toLowerCase();
    if (admins.has(email)) throw new HttpError(400, 'admins from ADMIN_EMAILS cannot be removed');
    if (!db.users.remove(email, { withData: c.req.query('deleteData') === '1' })) throw new HttpError(404, 'user not found');
    return c.json({ users: adminView() });
  });

  // Whisper transcription through Groq, used when the browser's speech recognition is
  // unavailable or the user prefers the more accurate engine.
  app.post('/api/transcribe', limited, async (c) => {
    if (!whisper) throw new HttpError(501, 'Whisper needs GROQ_API_KEY on the server');
    const form = await c.req.formData();
    const audio = form.get('audio');
    if (!(audio instanceof Blob) || audio.size === 0) throw new HttpError(400, 'audio file is required');
    if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, 'audio is larger than 25 MB');

    const upstream = new FormData();
    upstream.append('file', audio, audio.name || 'answer.webm');
    upstream.append('model', config.llm.groq.sttModel);
    upstream.append('response_format', 'json');
    upstream.append('temperature', '0');
    const language = String(form.get('language') || 'en').slice(0, 2);
    upstream.append('language', language);
    // The question text primes Whisper with the right technical vocabulary.
    const prompt = String(form.get('prompt') || '').slice(0, 800);
    if (prompt) upstream.append('prompt', prompt);

    const res = await fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.llm.groq.apiKey}` },
      body: upstream,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new HttpError(502, `transcription failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return c.json({ text: String(data.text || '').trim() });
  });

  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

  // Serve the built web app (production / Nexus). In development Vite serves it instead.
  if (existsSync(join(config.webDist, 'index.html'))) {
    const indexHtml = readFileSync(join(config.webDist, 'index.html'), 'utf8');
    app.use('/*', serveStatic({ root: config.webDist }));
    app.get('*', (c) => c.html(indexHtml));
  }

  return app;
}
