// Tracks Groq rate limits from the x-ratelimit-* headers on every response, plus this
// app's own daily usage. Limits are per model and per Groq organization, so another app
// on the same key (CV Forge) also draws from them; the headers reflect that, the local
// usage counters do not.

const KEY = 'llm.quota';
const KEEP_DAYS = 7;

/** "1m26.4s", "600ms", "2h3m", "7.66s" → milliseconds. */
export function parseDuration(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  let ms = 0;
  let matched = false;
  for (const [, n, unit] of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    ms += Number(n) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit];
  }
  return matched ? Math.round(ms) : null;
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const today = (now) => new Date(now).toISOString().slice(0, 10);

/**
 * @param {{ get(key: string): any, set(key: string, value: any): void } | null} store
 */
export function createQuota(store = null, clock = () => Date.now()) {
  const state = { models: {}, usage: {}, ...(store?.get(KEY) || {}) };
  const persist = () => {
    const days = Object.keys(state.usage).sort();
    for (const d of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete state.usage[d];
    store?.set(KEY, state);
  };
  const model = (name) => (state.models[name] ||= { model: name });

  return {
    /** Records one Groq response (successful or not). */
    record(name, headers, { tokens = 0, status = 200 } = {}) {
      const now = clock();
      const m = model(name);
      const h = (k) => headers?.get?.(k) ?? null;
      const limitReq = num(h('x-ratelimit-limit-requests'));
      if (limitReq !== null) {
        m.requestsLimit = limitReq;
        m.requestsRemaining = num(h('x-ratelimit-remaining-requests'));
        m.requestsResetAt = now + (parseDuration(h('x-ratelimit-reset-requests')) ?? 0);
        m.tokensLimit = num(h('x-ratelimit-limit-tokens'));
        m.tokensRemaining = num(h('x-ratelimit-remaining-tokens'));
        m.tokensResetAt = now + (parseDuration(h('x-ratelimit-reset-tokens')) ?? 0);
      }
      m.updatedAt = now;
      m.lastStatus = status;
      if (status === 429) {
        const wait = parseDuration(h('retry-after')) ?? 60_000;
        m.limitedUntil = now + wait;
      } else if (status < 400) {
        m.limitedUntil = null;
      }
      if (status < 400) {
        const day = (state.usage[today(now)] ||= {});
        const u = (day[name] ||= { requests: 0, tokens: 0 });
        u.requests += 1;
        u.tokens += tokens;
      }
      persist();
      return status === 429 ? m.limitedUntil - now : 0;
    },

    /** True while a 429 told us to back off from this model. */
    isLimited(name) {
      const until = state.models[name]?.limitedUntil;
      return !!until && until > clock();
    },

    snapshot(models) {
      const now = clock();
      const day = state.usage[today(now)] || {};
      return models.map((name) => {
        const m = state.models[name] || { model: name };
        return {
          model: name,
          requestsLimit: m.requestsLimit ?? null,
          // A rolling window: once its reset time passes the headers are stale, so
          // report the bucket as refilled rather than showing an old low number.
          requestsRemaining: m.requestsResetAt && m.requestsResetAt < now ? (m.requestsLimit ?? null) : (m.requestsRemaining ?? null),
          tokensLimit: m.tokensLimit ?? null,
          tokensRemaining: m.tokensResetAt && m.tokensResetAt < now ? (m.tokensLimit ?? null) : (m.tokensRemaining ?? null),
          limitedUntil: m.limitedUntil && m.limitedUntil > now ? new Date(m.limitedUntil).toISOString() : null,
          updatedAt: m.updatedAt ? new Date(m.updatedAt).toISOString() : null,
          usedToday: day[name] || { requests: 0, tokens: 0 },
        };
      });
    },
  };
}
