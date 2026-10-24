import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createAuth } from './auth.js';
import {
  HttpError,
  answerQuestion,
  computeStats,
  createSession,
  finishSession,
  generateModelAnswer,
  parseConfig,
  summarizeSession,
  weakQuestions,
} from './interview.js';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Fixed-window limiter for the routes that spend AI quota. */
function rateLimit(perMinute) {
  const hits = new Map();
  return async (c, next) => {
    const key = c.get('user') || c.req.header('x-forwarded-for') || 'local';
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
  const auth = createAuth(config.auth, authDeps);
  const limited = rateLimit(config.aiRateLimitPerMin);
  const whisper = !!config.llm.groq.apiKey;

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error('[server]', err);
    return c.json({ error: err.message || 'internal error' }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.use('/api/*', auth.middleware, async (c, next) => {
    onActivity();
    return next();
  });

  const load = (id) => {
    const session = db.get(id);
    if (!session) throw new HttpError(404, 'session not found');
    return session;
  };

  app.get('/api/meta', (c) =>
    c.json({ providers: llm.providers, whisper, authMode: auth.mode, user: c.get('user') || null }),
  );

  app.get('/api/stats', (c) => c.json(computeStats(db.list())));

  app.get('/api/sessions', (c) => c.json(db.list(Number(c.req.query('limit')) || 200).map(summarizeSession)));

  app.post('/api/sessions', limited, async (c) => {
    const config = parseConfig(await c.req.json().catch(() => ({})));
    const { data, provider } = await llm.run('plan', config);
    return c.json(db.create(createSession(config, data, provider)), 201);
  });

  // Practice session built from earlier answers that scored below 6.
  app.post('/api/sessions/weak', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const weak = weakQuestions(db.list()).slice(0, Math.min(10, Number(body.limit) || 5));
    if (!weak.length) throw new HttpError(404, 'No weak answers yet. Finish a few interviews first.');
    const config = parseConfig({ ...body, topic: 'Weak spots', type: 'mixed', questionCount: weak.length });
    return c.json(db.create(createSession(config, weak, 'history')), 201);
  });

  app.get('/api/sessions/:id', (c) => c.json(load(c.req.param('id'))));

  app.delete('/api/sessions/:id', (c) => {
    if (!db.remove(c.req.param('id'))) throw new HttpError(404, 'session not found');
    return c.json({ ok: true });
  });

  app.post('/api/sessions/:id/questions/:qid/answer', limited, async (c) => {
    const session = load(c.req.param('id'));
    const result = await answerQuestion(session, c.req.param('qid'), await c.req.json().catch(() => ({})), llm);
    db.save(session);
    return c.json({ ...result, session });
  });

  app.post('/api/sessions/:id/finish', limited, async (c) => {
    const session = await finishSession(load(c.req.param('id')), llm, (s) => db.save(s));
    return c.json(db.save(session));
  });

  app.post('/api/sessions/:id/questions/:qid/model-answer', limited, async (c) => {
    const session = load(c.req.param('id'));
    const question = await generateModelAnswer(session, c.req.param('qid'), llm);
    db.save(session);
    return c.json({ question, session });
  });

  app.get('/api/quota', (c) => c.json(llm.quota() ?? { provider: null, models: [] }));

  // Spends one tiny request per model to get fresh limit headers.
  app.post('/api/quota/refresh', limited, async (c) => c.json((await llm.refreshQuota()) ?? { provider: null, models: [] }));

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
