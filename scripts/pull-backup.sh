#!/usr/bin/env bash
# Copies Interview Sim's nightly database backups off the phone, onto this laptop.
# Nexus makes one consistent copy a day (scripts/backup-db.sh, cron 3:30 AM IST) but keeps
# it on the same phone; this pulls any it doesn't have yet over Tailscale, checks each
# with SQLite's integrity_check, and keeps the last 30. Run daily by the systemd user
# timer in scripts/systemd/ (install with scripts/install-backup-timer.sh).
# Failures (Nexus unreachable, bad copy, the phone's backup going stale) raise a
# desktop notification and exit non-zero, so `systemctl --user status` shows them too.
set -uo pipefail

NEXUS="${NEXUS_HOST:-nexus}"
REMOTE="nexus/backups/interview-sim"
DEST="${ISIM_BACKUP_DIR:-$HOME/Backups/interview-sim}"
KEEP=30
STALE_DAYS=2

fail() {
  echo "$(date -Is) FAILED: $*" >&2
  notify-send -u critical "Interview Sim backup" "$*" 2>/dev/null || true
  exit 1
}

mkdir -p "$DEST" && chmod 700 "$DEST"
listing=$(ssh -o BatchMode=yes -o ConnectTimeout=20 "$NEXUS" "ls -1 $REMOTE") || fail "couldn't reach $NEXUS to list backups"

new=0
for f in $listing; do
  [[ $f =~ ^interview-sim-[0-9]{4}-[0-9]{2}-[0-9]{2}\.db$ ]] || continue
  [ -f "$DEST/$f" ] && continue
  scp -q -o BatchMode=yes -o ConnectTimeout=20 "$NEXUS:$REMOTE/$f" "$DEST/$f.part" || fail "copying $f failed"
  if ! python3 -I -c '
import sqlite3, sys
db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
sys.exit(db.execute("PRAGMA integrity_check").fetchone()[0] != "ok")' "$DEST/$f.part"; then
    rm -f "$DEST/$f.part"
    fail "$f failed its integrity check"
  fi
  chmod 600 "$DEST/$f.part" && mv "$DEST/$f.part" "$DEST/$f"
  new=$((new + 1))
done

latest=$(find "$DEST" -maxdepth 1 -name 'interview-sim-*.db' -printf '%f\n' | sort | tail -n 1)
[ -n "$latest" ] || fail "no backups found on $NEXUS"
ls -1 "$DEST"/interview-sim-*.db | sort | head -n -"$KEEP" | xargs -r rm -f

# The phone's own cron can stop silently (crond killed, see ~/nexus/ensure-up.sh).
day=${latest#interview-sim-}; day=${day%.db}
age=$(( ( $(date +%s) - $(date -d "$day" +%s) ) / 86400 ))
[ "$age" -le "$STALE_DAYS" ] || fail "newest backup is from $day ($age days old) — is the cron on Nexus running?"

echo "$(date -Is) ok: $new new, newest $latest, $(ls -1 "$DEST"/interview-sim-*.db | wc -l) kept in $DEST"
