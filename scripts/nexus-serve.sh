#!/data/data/com.termux/files/usr/bin/bash
# Runs the Interview Sim server in the foreground (inside the "interview-sim" tmux session),
# restarting it if it exits. Logs to logs/server.log.
export PATH="/data/data/com.termux/files/usr/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
termux-wake-lock 2>/dev/null || true
while true; do
  echo "$(date -u +%FT%TZ) starting interview-sim" >>logs/server.log
  npm start --silent >>logs/server.log 2>&1
  echo "$(date -u +%FT%TZ) interview-sim exited ($?), restarting in 10s" >>logs/server.log
  sleep 10
done
