#!/usr/bin/env bash
# Delegate a task to a new agent-deck session on an always-on box: it runs in tmux, so Moshi shows it under Workspaces /
# Jump To with its status, its permission prompts arrive as approve/deny cards, and it asks decisions with
# workers/phone/decide.sh (buttons on the phone). One card tells you it started; the session ends with a done line.
# usage (on an always-on box):  workers/phone/delegate.sh <name> "<task>"
#        (from your laptop): ssh <box> 'cd <project> && workers/phone/delegate.sh <name> "<task>"'
set -euo pipefail
[ -x "$HOME/.local/bin/moshi-hook" ] && MOSHI=${MOSHI:-$HOME/.local/bin/moshi-hook}  # a user-owned copy can update itself
name=${1:?name}; task=${2:?task}
[[ $name =~ ^[a-z0-9-]{2,30}$ ]] || { echo "name: 2-30 of a-z 0-9 -"; exit 2; }
root=$(cd "$(dirname "$0")/../.." && pwd)
brief="$task

How to work (delegated from your laptop, the human is away from the keyboard and reads Moshi on the phone):
- When you need the human to choose, run: workers/phone/decide.sh --source $name \"<question>\" \"<option 1>\" \"<option 2>\" (up to 6 options) and use the printed choice. Do not wait for a chat reply.
- For a run longer than a minute, wrap it: workers/phone/job.sh \"<title>\" <command...>
- Follow CLAUDE.md (no outward action without a yes: ask it with workers/phone/decide.sh). When done, end with one line: DONE: <what is true now>."
agent-deck launch "$root" -t "$name" -c claude --trust-folder --message "$brief" >/dev/null
"${MOSHI:-moshi-hook}" notify --source delegate --title "Delegated: $name" "Running on an always-on box in session $name. Moshi → Workspaces → $name to watch or jump in." >/dev/null 2>&1 || true
echo "delegated '$name' (agent-deck session on an always-on box; Moshi shows it under Workspaces)"
