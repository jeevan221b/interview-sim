#!/data/data/com.termux/files/usr/bin/bash
# Watchdog (called by ~/nexus/ensure-up.sh): start the interview-sim tmux session if it isn't running.
export PATH="/data/data/com.termux/files/usr/bin:$PATH"

SESSION="interview-sim"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

tmux has-session -t "$SESSION" 2>/dev/null && exit 0
# Google sign-in without a client ID would only crash-loop; wait until .env is filled in.
if grep -q '^AUTH_MODE=google' "$DIR/.env" 2>/dev/null && ! grep -q '^GOOGLE_CLIENT_ID=.' "$DIR/.env"; then exit 0; fi

echo "$(date -u +%FT%TZ) '$SESSION' not running — starting"
tmux new-session -d -s "$SESSION" "$DIR/scripts/nexus-serve.sh"
