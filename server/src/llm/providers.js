import { spawn } from 'node:child_process';

const TIMEOUT_MS = 90_000;

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text);
}

/** Google Gemini (free tier via AI Studio key). */
export function gemini({ apiKey, model }) {
  return {
    name: 'gemini',
    label: `Gemini (${model})`,
    available: !!apiKey,
    async complete({ system, user, temperature, parse }) {
      const data = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': apiKey },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature, responseMimeType: 'application/json' },
        },
      );
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts
        .filter((p) => !p.thought)
        .map((p) => p.text || '')
        .join('');
      if (!text) throw new Error(`empty Gemini response (${data?.candidates?.[0]?.finishReason || 'no candidates'})`);
      return { data: parse(text), model };
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A 429 this short is the per-minute token bucket refilling: waiting beats dropping to a weaker model.
const MAX_INLINE_WAIT_MS = 8_000;

/**
 * Groq (OpenAI-compatible API, free tier). Rate limits are per model, so `models` is a
 * chain: when one is rate-limited, down or returns unusable output, the next is tried.
 */
export function groq({ apiKey, models, reasoningEffort }, { quota, log = console, fetchImpl = fetch } = {}) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';

  async function request(model, body) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, ...body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON error page */
    }
    const waitMs = quota?.record(model, res.headers, { status: res.status, tokens: json?.usage?.total_tokens || 0 }) || 0;
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${(json?.error?.message || text).slice(0, 300)}`);
      err.status = res.status;
      err.waitMs = waitMs;
      throw err;
    }
    return json;
  }

  const extras = (model) =>
    // gpt-oss reasons before answering; "low" keeps that (and the token bill) small.
    model.startsWith('openai/gpt-oss') && reasoningEffort ? { reasoning_effort: reasoningEffort } : {};

  return {
    name: 'groq',
    label: `Groq (${models.join(' → ')})`,
    models,
    available: !!apiKey && models.length > 0,

    async complete({ system, user, temperature, maxTokens, parse }) {
      const errors = [];
      const usable = models.filter((m) => !quota?.isLimited(m));
      if (!usable.length) throw new Error('every Groq model is rate-limited right now; try again in a minute');
      for (const model of usable) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const data = await request(model, {
              temperature,
              ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
              ...extras(model),
            });
            const text = data?.choices?.[0]?.message?.content;
            if (!text) throw new Error(`empty response (${data?.choices?.[0]?.finish_reason || 'no choices'})`);
            return { data: parse(text), model };
          } catch (err) {
            if (err.status === 401 || err.status === 403) throw new Error(`Groq rejected the API key (HTTP ${err.status})`);
            if (err.status === 429 && attempt === 0 && err.waitMs > 0 && err.waitMs <= MAX_INLINE_WAIT_MS) {
              await sleep(err.waitMs + 250);
              continue;
            }
            log.warn?.(`[llm] groq ${model} failed: ${err.message}`);
            errors.push(`${model}: ${err.message}`);
            break;
          }
        }
      }
      throw new Error(errors.join(' | '));
    },

    /** Smallest possible call per model, just to refresh the rate-limit headers. */
    async probe() {
      for (const model of models) {
        try {
          await request(model, { max_completion_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
        } catch (err) {
          log.warn?.(`[llm] groq probe ${model}: ${err.message}`);
        }
      }
    },
  };
}

/**
 * Local Claude Code CLI in headless mode (`claude -p`). Laptop-only and experimental:
 * it uses your Claude subscription's limits and starts a CLI process per call.
 */
export function claudeCli({ bin, model }) {
  return {
    name: 'claude-cli',
    label: `Claude Code CLI${model ? ` (${model})` : ''}`,
    available: true,
    complete({ system, user, parse }) {
      const args = ['-p', '--output-format', 'json', '--system-prompt', system];
      if (model) args.push('--model', model);
      return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS * 2);
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('error', (e) => {
          clearTimeout(timer);
          reject(new Error(`could not run ${bin}: ${e.message}`));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          try {
            const parsed = JSON.parse(out);
            if (parsed.is_error || code !== 0) throw new Error(parsed.result || `exit ${code}`);
            resolve({ data: parse(parsed.result), model: model || 'claude' });
          } catch (e) {
            reject(new Error(`claude CLI failed: ${e.message} ${err.slice(0, 200)}`));
          }
        });
        child.stdin.end(user);
      });
    },
  };
}
