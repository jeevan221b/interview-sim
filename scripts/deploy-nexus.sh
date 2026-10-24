#!/usr/bin/env bash
# =============================================================================
#  Interview Sim — deploy to Nexus (Termux / Android) over git + ssh
# =============================================================================
#  Modeled on mission-control/scripts/deploy-nexus.sh. Runs the tests, builds
#  web/dist on the laptop (the phone never builds the UI), pushes to a bare repo
#  on Nexus, updates the working tree there, ships web/dist over ssh, installs
#  the server's runtime deps and restarts the tmux session "interview-sim".
#  Public URL: https://interview.jeevanraj.dev (Cloudflare tunnel -> 127.0.0.1:8920).
#
#  Idempotent — safe to re-run. Never touches the Nexus .env or data/.
#
#      ./scripts/deploy-nexus.sh                  # full deploy + restart
#      ./scripts/deploy-nexus.sh --no-restart     # sync code only, leave running session
#      ./scripts/deploy-nexus.sh --status         # health + tmux state
#      ./scripts/deploy-nexus.sh --stop           # stop the remote tmux session
#      ./scripts/deploy-nexus.sh --logs           # tail the remote server log
#
#  Env overrides: NEXUS_HOST (default "nexus"), ISIM_SKIP_TESTS=1.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

NEXUS="${NEXUS_HOST:-nexus}"
REMOTE_DIR="Projects/interview-sim"
BARE="git/interview-sim.git"
SESSION="interview-sim"

RESTART=1; MODE="deploy"
while [ $# -gt 0 ]; do
  case "$1" in
    --no-restart) RESTART=0; shift;;
    --status)     MODE="status"; shift;;
    --stop)       MODE="stop"; shift;;
    --logs)       MODE="logs"; shift;;
    -h|--help)    sed -n '2,20p' "$0"; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m%s\n' "$*" >&2; }

case "$MODE" in
  status)
    ssh "$NEXUS" "tmux has-session -t $SESSION 2>/dev/null && echo 'tmux session: UP' || echo 'tmux session: DOWN'
                  curl -sf http://127.0.0.1:8920/api/health && echo || echo 'api: unreachable'
                  curl -s -o /dev/null -w 'public url: HTTP %{http_code}\n' https://interview.jeevanraj.dev/api/auth/config"
    exit 0;;
  stop)
    say "Stopping tmux session '$SESSION' on $NEXUS"
    ssh "$NEXUS" "tmux kill-session -t $SESSION 2>/dev/null && echo stopped || echo 'was not running'"
    exit 0;;
  logs)
    ssh "$NEXUS" "tail -n 100 ~/$REMOTE_DIR/logs/server.log" || { warn "no log yet"; exit 1; }
    exit 0;;
esac

if [ -n "$(git status --porcelain)" ]; then
  warn "uncommitted changes are not deployed — commit them first:"
  git status --short >&2
  exit 1
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "${ISIM_SKIP_TESTS:-0}" != 1 ]; then
  say "Running tests"
  npm test --silent
fi

say "Building web/dist"
npm run build --silent

if ! git remote get-url nexus >/dev/null 2>&1; then
  say "Bootstrapping bare repo $NEXUS:~/$BARE and git remote 'nexus'"
  ssh "$NEXUS" "mkdir -p '$BARE' && cd '$BARE' && (git rev-parse --is-bare-repository >/dev/null 2>&1 || git init --bare -q)"
  git remote add nexus "$NEXUS:$BARE"
fi

say "Pushing '$BRANCH' -> $NEXUS:~/$BARE"
git push -q nexus "$BRANCH"

say "Updating working tree on Nexus"
ssh "$NEXUS" "bash -s" <<EOF
set -e
if [ ! -d "\$HOME/$REMOTE_DIR/.git" ]; then
  mkdir -p "\$(dirname "\$HOME/$REMOTE_DIR")"
  git clone -q "\$HOME/$BARE" "\$HOME/$REMOTE_DIR"
fi
cd "\$HOME/$REMOTE_DIR"
git fetch -q origin
git checkout -q -B "$BRANCH" "origin/$BRANCH"
git reset --hard -q "origin/$BRANCH"
mkdir -p data logs
chmod +x scripts/*.sh
EOF

say "Shipping web/dist"
tar -C web -czf - dist | ssh "$NEXUS" "cd ~/$REMOTE_DIR/web && rm -rf dist.new && mkdir dist.new && tar -xzf - -C dist.new --strip-components=1 && rm -rf dist && mv dist.new dist"

say "Installing server dependencies"
ssh "$NEXUS" "cd ~/$REMOTE_DIR && npm install --omit=dev -w server --no-audit --no-fund --loglevel=error"

ssh "$NEXUS" "bash -s" <<EOF
cd "\$HOME/$REMOTE_DIR"
grep -q '^AUTH_MODE=google' .env 2>/dev/null || echo "!! ~/$REMOTE_DIR/.env is missing or not AUTH_MODE=google — the server will refuse to start until it is set up" >&2
grep -q 'interview-sim/scripts/nexus-watchdog.sh' "\$HOME/nexus/ensure-up.sh" || echo "!! ~/nexus/ensure-up.sh doesn't run the interview-sim watchdog — it won't come back after a crash or reboot" >&2
crontab -l 2>/dev/null | grep -q 'interview-sim/scripts/backup-db.sh' || echo "!! no daily backup cron line for interview-sim" >&2
true
EOF

if [ "$RESTART" = 1 ]; then
  say "Restarting tmux session '$SESSION'"
  ssh "$NEXUS" "tmux kill-session -t $SESSION 2>/dev/null; ~/$REMOTE_DIR/scripts/nexus-watchdog.sh"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 2
    if ssh "$NEXUS" "curl -sf http://127.0.0.1:8920/api/health >/dev/null"; then
      say "Up: https://interview.jeevanraj.dev"
      exit 0
    fi
  done
  warn "server did not answer on 127.0.0.1:8920 — last log lines:"
  ssh "$NEXUS" "tail -n 20 ~/$REMOTE_DIR/logs/server.log" >&2 || true
  exit 1
fi
