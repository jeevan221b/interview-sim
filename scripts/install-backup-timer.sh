#!/usr/bin/env bash
# Installs the daily off-phone backup pull (systemd user timer) on this laptop and runs it once.
set -euo pipefail
cd "$(dirname "$0")"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
for unit in interview-sim-backup.service interview-sim-backup.timer; do
  ln -sf "$PWD/systemd/$unit" "$UNIT_DIR/$unit"
done
systemctl --user daemon-reload
systemctl --user enable --now interview-sim-backup.timer
systemctl --user start interview-sim-backup.service
systemctl --user list-timers interview-sim-backup.timer --no-pager
