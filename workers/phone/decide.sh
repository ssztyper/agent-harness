#!/usr/bin/env bash
# Ask the human a question on their phone (Moshi) and print the chosen option; the caller blocks until they answer.
# For agents and scripts on an always-on box: a decision with buttons instead of a chat message, a mail or a code.
# usage: workers/phone/decide.sh [--timeout 60m] [--source name] "<question>" <option> <option> [...]   (2-6 options)
# exit: 0 answered (choice on stdout) · 1 denied/cancelled · 3 timed out · 4 Moshi unreachable. Logged to log/decisions.jsonl.
set -uo pipefail
[ -x "$HOME/.local/bin/moshi-hook" ] && MOSHI=${MOSHI:-$HOME/.local/bin/moshi-hook}  # a user-owned copy can update itself
timeout=60m source=agent
while [[ ${1:-} == --* ]]; do case $1 in --timeout) timeout=$2; shift 2 ;; --source) source=$2; shift 2 ;; *) echo "unknown flag $1"; exit 2 ;; esac; done
q=${1:?question}; shift
[ $# -ge 2 ] && [ $# -le 6 ] || { echo "give 2-6 options"; exit 2; }
# Multiple-choice cards fail on moshi-hook 0.4.45 (the phone shows "failed"); yes/no cards work. Until the always-on box runs a
# newer moshi-hook (MOSHI_OPTIONS=1), ask one yes/no card per option, in order, and take the first approved one.
if [ "${MOSHI_OPTIONS:-0}" = 1 ]; then
  args=(); for o in "$@"; do args+=(--option "$o"); done
  choice=$("${MOSHI:-moshi-hook}" ask --require-remote --timeout "$timeout" --source "$source" "${args[@]}" "$q"); rc=$?
else
  choice="" rc=1 n=$#; i=0
  for o in "$@"; do
    i=$((i + 1))
    "${MOSHI:-moshi-hook}" ask --require-remote --timeout "$timeout" --source "$source" "$q — option $i/$n: $o?  (Approve = choose this, Deny = next option)"; r=$?
    if [ $r -eq 0 ]; then choice=$o; rc=0; break; fi
    if [ $r -ne 1 ]; then rc=$r; break; fi   # timeout or Moshi unreachable: stop asking
  done
fi
dir=$(cd "$(dirname "$0")/../.." && pwd); mkdir -p "$dir/log"
printf '{"at":"%s","source":"%s","question":%s,"choice":%s,"exit":%d}\n' "$(date -u +%FT%TZ)" "$source" \
  "$(printf %s "$q" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" \
  "$(printf %s "$choice" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" "$rc" >> "$dir/log/decisions.jsonl"
[ $rc -eq 0 ] && echo "$choice"
exit $rc
