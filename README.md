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

## Users and access

Invite-only. Authentication proves who someone is ("Sign in with Google", a Cloudflare Access login, or
the owner's access token); the app's own users table decides whether they get in. With Google sign-in the
Admin page's invite list is the only list to keep: add an email there and that person can sign in.

- **Admin** (`ADMIN_EMAILS`): the Admin page to invite, pause or remove people, set per-person daily AI
  limits, and see activity counts (not anyone's answers) plus the Groq quota. Settings shows the system
  cards (AI providers, access) only to admins; voice and speech preferences are per device for everyone.
- **Everyone's data is private**: interviews, stats, history and custom topics are scoped to the signed-in
  email and follow them across devices. Interviews from before multi-user support belong to the first admin.
- **Daily AI allowance**: checked when an interview starts (using its estimated request count), never in the
  middle of one. Removing a person can optionally delete their data.
- **Local development** (`AUTH_MODE=none`): you are the first admin; the Admin page's "View as" (the
  `X-Dev-User` header) lets you try the app as an invited user on one machine.

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
| `AUTH_MODE` | `none` | `none`, `google`, `cloudflare`, `token`, or a combination like `google,token` |
| `GOOGLE_CLIENT_ID` | | Google OAuth *Web application* client ID (`….apps.googleusercontent.com`). Its authorized JavaScript origins must list the site (and `http://localhost:5173` for development). Sessions last 30 days; the signing key is generated into the database. |
| `ACCESS_TOKEN` | | ≥24 chars; sent as `Authorization: Bearer`; signs in as the first admin. Open the app once with `/#token=…` to save it on a device. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | | Cloudflare Access JWT verification (team domain like `me.cloudflareaccess.com`) |
| `ADMIN_EMAILS` | | Admins: always allowed, see the Admin page, no daily limit. Required unless `AUTH_MODE=none`. |
| `ALLOWED_EMAILS` | | Optional users to invite at startup (normally invite from the Admin page) |
| `DAILY_AI_LIMIT` | `60` | AI requests per user per day; admins unlimited; overridable per user |
| `AI_RATE_LIMIT_PER_MIN` | `20` | Cap on AI-spending requests |
| `IDLE_SHUTDOWN_MINUTES` | `0` | Exit after N idle minutes (for on-demand hosting) |
| `DB_PATH` | `data/interview-sim.db` | SQLite file |

The server refuses to bind to a non-localhost address while `AUTH_MODE=none`.

## Deploying to Nexus

Runs 24/7 on Nexus at **https://interview.jeevanraj.dev**: the existing Cloudflare tunnel routes that hostname
to `127.0.0.1:8920` (the server binds to localhost only, so nothing reaches it except through the tunnel), and
Cloudflare provides the HTTPS the microphone needs. Sign-in is `AUTH_MODE=google`; `ADMIN_EMAILS` is the owner only.

```bash
./scripts/deploy-nexus.sh            # tests, build web/dist, push, ship dist, npm install, restart
./scripts/deploy-nexus.sh --status   # tmux + local health + public URL
./scripts/deploy-nexus.sh --logs     # tail logs/server.log on Nexus
```

On Nexus: tmux session `interview-sim` runs `scripts/nexus-serve.sh` (restarts the server if it exits);
`~/nexus/ensure-up.sh` calls `scripts/nexus-watchdog.sh` so it comes back after a reboot or a killed Termux;
cron runs `scripts/backup-db.sh` daily into `~/nexus/backups/interview-sim/` (last 14 kept). The `.env` and
`data/` on Nexus are never overwritten by a deploy.

## Layout

```
server/   Hono API: sessions, answers, AI providers with fallback, auth, Whisper proxy (node --test)
web/      React + Vite + Tailwind + Motion UI (vitest)
shared/   speech metrics (words, wpm, fillers, delivery score) used by both
```

`npm test` runs both test suites.
