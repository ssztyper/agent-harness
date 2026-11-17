#!/usr/bin/env bash
# Run a long command as one live row in the Moshi inbox (start → updates → end), instead of many pushes.
# usage: workers/phone/job.sh "<title>" <command...>    e.g. workers/phone/job.sh "Lab: critic" node scripts/lab.mjs test critic
set -uo pipefail
[ -x "$HOME/.local/bin/moshi-hook" ] && MOSHI=${MOSHI:-$HOME/.local/bin/moshi-hook}  # a user-owned copy can update itself
title=${1:?title}; shift
id=$("${MOSHI:-moshi-hook}" job start --source job "$title" 2>/dev/null || true)
start=$(date +%s)
"$@" 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line"
  [ -n "$id" ] && "${MOSHI:-moshi-hook}" job update "$id" --message "$(printf %s "$line" | cut -c1-120)" >/dev/null 2>&1 || true
done
rc=${PIPESTATUS[0]}
if [ -n "$id" ]; then
  if [ "$rc" -eq 0 ]; then "${MOSHI:-moshi-hook}" job end "$id" >/dev/null 2>&1; else "${MOSHI:-moshi-hook}" job end "$id" --error >/dev/null 2>&1; fi
fi
echo "job '$title' finished: exit $rc in $(( $(date +%s) - start ))s"
exit "$rc"
