#!/data/data/com.termux/files/usr/bin/bash
# Daily consistent copy of the SQLite database (cron on Nexus). Keeps the last 14.
# Same phone as the live DB: protects against mistakes and corruption, not losing the phone.
export PATH="/data/data/com.termux/files/usr/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1
DEST="$HOME/nexus/backups/interview-sim"
mkdir -p "$DEST"
OUT="$DEST/interview-sim-$(date +%F).db"
rm -f "$OUT"
node --disable-warning=ExperimentalWarning -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  db.prepare("VACUUM INTO ?").run(process.argv[2]);
' data/interview-sim.db "$OUT" && echo "$(date -u +%FT%TZ) backed up to $OUT"
ls -1t "$DEST"/interview-sim-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f
