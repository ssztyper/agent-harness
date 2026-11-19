#!/usr/bin/env bash
# Ask the human a question on their phone (Moshi) and print the chosen option; the caller blocks until they answer.
# For agents and scripts on an always-on box: a decision with buttons instead of a chat message, a mail or a code.
# usage: workers/phone/decide.sh [--timeout 60m] [--source name] [--url <link>] [--check "<cmd>"] "<question>" <option> <option> [...]
#   --url    the page where the human acts; sent with the full question as an inbox notification and kept for
#            `links.sh`, because cards cannot open or copy links
#   --check  a command that must exit 0 after the FIRST option is chosen (e.g. "the key is in vars.json", "the decision
#            is saved"); when it fails the card comes back once more, saying what is still missing, because a
#            Ready pressed too early proves nothing
# exit: 0 answered (choice on stdout) · 1 denied/cancelled · 3 timed out · 4 Moshi unreachable · 5 check still failing.
# Logged to log/decisions.jsonl.
set -uo pipefail
[ -x "$HOME/.local/bin/moshi-hook" ] && MOSHI=${MOSHI:-$HOME/.local/bin/moshi-hook}  # a user-owned copy can update itself
timeout=60m source=agent url="" check=""
while [[ ${1:-} == --* ]]; do case $1 in
  --timeout) timeout=$2; shift 2 ;; --source) source=$2; shift 2 ;;
  --url) url=$2; shift 2 ;; --check) check=$2; shift 2 ;;
  *) echo "unknown flag $1"; exit 2 ;; esac; done
q=${1:?question}; shift
[ $# -ge 2 ] && [ $# -le 6 ] || { echo "give 2-6 options"; exit 2; }
dir=$(cd "$(dirname "$0")/.." && pwd); mkdir -p "$dir/log"
# A card shows at most 256 characters (Moshi docs) and links open neither on cards nor in the inbox, so the full text
# and the link go to the inbox as a notification first, the link is kept for `links.sh` (the phone's terminal can open
# or copy it), and the card keeps a short form that fits.
full=$q; [ -n "$url" ] && full="$q
Copy this link into Safari:
$url"
if [ -n "$url" ]; then  # the Moshi terminal is the one place on the phone where a link can be tapped or copied
  printf '%s\t%s\t%s\n' "$(date +%H:%M)" "${q:0:60}" "$url" >> "$dir/log/links.txt"
fi
if [ ${#full} -gt 200 ] || [ -n "$url" ]; then
  "${MOSHI:-moshi-hook}" notify --source "$source" --title "Decision needed" "$full" >/dev/null 2>&1
  if [ -n "$url" ]; then q="${q:0:120}… (link: run 'links' in the Moshi terminal)"; else q="${q:0:140}… (details in inbox)"; fi
fi

ask() {  # $1 = question; sets choice and rc
  # Multiple-choice cards can fail in the phone app; yes/no cards work. Until a newer
  # moshi-hook is confirmed (MOSHI_OPTIONS=1), ask one yes/no card per option, in order, and take the first approved one.
  if [ "${MOSHI_OPTIONS:-0}" = 1 ]; then
    local args=(); for o in "${opts[@]}"; do args+=(--option "$o"); done
    choice=$("${MOSHI:-moshi-hook}" ask --require-remote --timeout "$timeout" --source "$source" "${args[@]}" "$1"); rc=$?
  else
    choice="" rc=1; local n=${#opts[@]} i=0 r
    for o in "${opts[@]}"; do
      i=$((i + 1))
      "${MOSHI:-moshi-hook}" ask --require-remote --timeout "$timeout" --source "$source" "$1 — $i/$n: $o? (Approve=yes, Deny=next)"; r=$?
      if [ $r -eq 0 ]; then choice=$o; rc=0; break; fi
      if [ $r -ne 1 ]; then rc=$r; break; fi   # timeout or Moshi unreachable: stop asking
    done
  fi
}
log() {
  printf '{"at":"%s","source":"%s","question":%s,"choice":%s,"exit":%d}\n' "$(date -u +%FT%TZ)" "$source" \
    "$(printf %s "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" \
    "$(printf %s "$choice" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" "$rc" >> "$dir/log/decisions.jsonl"
}

opts=("$@")
ask "$q"; log "$q"
if [ $rc -eq 0 ] && [ -n "$check" ] && [ "$choice" = "${opts[0]}" ] && ! bash -c "$check" >/dev/null 2>&1; then
  q2="Not done yet after \"$choice\": ${q:0:150}"
  ask "$q2"; log "$q2"
  if [ $rc -eq 0 ] && [ "$choice" = "${opts[0]}" ] && ! bash -c "$check" >/dev/null 2>&1; then rc=5; fi
fi
[ $rc -eq 0 ] && echo "$choice"
exit $rc
