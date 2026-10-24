# Interview Sim

Voice-first mock interviews with AI feedback. Pick a topic, the interviewer reads each question aloud,
you answer by speaking (transcribed live), and at the end you get a debrief: scores per dimension,
covered/missed points, model answers, and delivery stats (pace, filler words, pauses).

Works for any field: preset topics cover Computer & IT, Electrical & Electronics, Mechanical, Civil,
Medical & Healthcare, Business & Management and soft skills, and you can create your own topic in any field
(saved per device) with optional focus areas. The AI prompts adapt to the field and role.

Free to run: Groq's free tier for the AI and Whisper transcription (same key as CV Forge), browser speech APIs for voice, SQLite for storage.
Set `LLM_PROVIDERS=mock` to use a built-in offline mock interviewer (no key needed) for trying the flow.

## Run locally

```bash
npm install
cp .env.example .env      # add GROQ_API_KEY (or set LLM_PROVIDERS=mock to try it offline)
npm run dev               # API on :8920, UI on http://localhost:5173
```

Use Chrome or Edge for live speech recognition. Firefox/Safari can use Whisper (needs `GROQ_API_KEY`) or typed answers.

Free API keys:
- Gemini: <https://aistudio.google.com/apikey>
- Groq (also enables Whisper transcription): <https://console.groq.com/keys>

## Keeping AI usage low

- **Grading at the end** (per interview, in setup): answers are graded in batches of 3 when you finish,
  so a 6-question interview is ~4 AI requests instead of ~11. No instant feedback or follow-ups in that mode.
- **Model answers**: brief (default), detailed, or on request (generated only when you tap
  "Show model answer" in the report).
- **AI quota** in Settings shows each model's remaining requests (from Groq's rate-limit headers) and this
  app's own usage today; the setup screen warns when an interview may not fit in what's left.

## Production / single process

```bash
npm run build             # builds web/dist
npm start                 # server serves the UI and API on HOST:PORT (default 127.0.0.1:8920)
```

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDERS` | `groq` | Providers tried in order (`groq`, `gemini`, `claude-cli`, `mock`); the next one is used if one fails or is rate-limited. `claude-cli` uses your local `claude -p` (laptop only, counts against your plan). |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | `gemini-2.5-flash` | Optional, Google AI Studio free tier |
| `GROQ_API_KEY` | | Groq free tier key (shared with CV Forge) |
| `GROQ_MODELS` | `openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b` | Model chain. Groq limits are per model (≈1000 requests/day, 8000 tokens/min on the free tier), so the next model takes over when one is rate-limited, down, or returns bad JSON. |
| `GROQ_REASONING_EFFORT` | `low` | gpt-oss reasoning effort; `low` keeps token use down |
| `GROQ_STT_MODEL` | `whisper-large-v3-turbo` | Whisper transcription |
| `AUTH_MODE` | `none` | `none`, `token`, `cloudflare`, or `cloudflare,token` |
| `ACCESS_TOKEN` | | ≥24 chars; sent as `Authorization: Bearer`. Open the app once with `/#token=…` to save it on a device. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ALLOWED_EMAILS` | | Cloudflare Access JWT verification (team domain like `me.cloudflareaccess.com`) |
| `AI_RATE_LIMIT_PER_MIN` | `20` | Cap on AI-spending requests |
| `IDLE_SHUTDOWN_MINUTES` | `0` | Exit after N idle minutes (for on-demand hosting) |
| `DB_PATH` | `data/interview-sim.db` | SQLite file |

The server refuses to bind to a non-localhost address while `AUTH_MODE=none`.

## Deploying to Nexus (later)

Termux-friendly by design: plain-JS server (no build step), Node's built-in `node:sqlite` (no native modules),
and the UI is built on the laptop and shipped as static files. Plan:

1. Build `web/dist` on the laptop, then sync the repo to Nexus and run `npm install --omit=dev -w server`.
2. Run `npm start` in tmux with `PORT=8920`, `IDLE_SHUTDOWN_MINUTES=30`, launched on demand from Mission Control.
3. Expose it through the existing Cloudflare tunnel as its own hostname behind Cloudflare Access
   (allow only your email) and set `AUTH_MODE=cloudflare,token`.
   The microphone needs HTTPS, which the tunnel provides.

## Layout

```
server/   Hono API: sessions, answers, AI providers with fallback, auth, Whisper proxy (node --test)
web/      React + Vite + Tailwind + Motion UI (vitest)
shared/   speech metrics (words, wpm, fillers, delivery score) used by both
```

`npm test` runs both test suites.
