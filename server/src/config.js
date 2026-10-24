import { fileURLToPath } from 'node:url';

const list = (value, fallback) =>
  (value ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));

export function loadConfig(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: num(env.PORT, 8920),
    dbPath: env.DB_PATH || fileURLToPath(new URL('../../data/interview-sim.db', import.meta.url)),
    webDist: env.WEB_DIST || fileURLToPath(new URL('../../web/dist', import.meta.url)),
    auth: {
      modes: list(env.AUTH_MODE, 'none'),
      accessToken: env.ACCESS_TOKEN || '',
      cfTeamDomain: (env.CF_ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
      cfAud: env.CF_ACCESS_AUD || '',
      allowedEmails: list(env.ALLOWED_EMAILS, '').map((e) => e.toLowerCase()),
    },
    llm: {
      providers: list(env.LLM_PROVIDERS, 'groq'),
      gemini: { apiKey: env.GEMINI_API_KEY || '', model: env.GEMINI_MODEL || 'gemini-2.5-flash' },
      groq: {
        apiKey: env.GROQ_API_KEY || '',
        // Tried in order; Groq's free-tier limits are per model, so later ones keep the app
        // working when the first is exhausted. GROQ_MODEL alone (older configs) still works.
        models: list(env.GROQ_MODELS, env.GROQ_MODEL || 'openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b'),
        reasoningEffort: env.GROQ_REASONING_EFFORT ?? 'low',
        sttModel: env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
      },
      claudeCli: { bin: env.CLAUDE_BIN || 'claude', model: env.CLAUDE_MODEL || '' },
    },
    aiRateLimitPerMin: num(env.AI_RATE_LIMIT_PER_MIN, 20),
    idleShutdownMinutes: num(env.IDLE_SHUTDOWN_MINUTES, 0),
  };
}
