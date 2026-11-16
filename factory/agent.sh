#!/usr/bin/env bash
# /agent for Claude Code + Herdr (or tmux in the lab): open a supporting agent in a pane beside Main.
# The agent follows only Main's conversation (fed by the agent-feed hook), runs on a small, fast model, numbers its
# findings and sends nothing back by itself. Opening it adds no turn to Main: run it from a shell.
# usage: factory/agent.sh <name> [--job "text"] [--model haiku] [--main tN] [--tmux]
#        factory/agent.sh send main #<n> [--agent <name>]     queue one finding; it joins Main's next prompt
#        factory/agent.sh                                     list saved agents      --help  this guide
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); project=$(cd "$here/.." && pwd -P)
feed="$project/log/agent-feed"

usage() {
  cat <<'EOF'
agent.sh: a supporting agent beside Main that watches Main's conversation and shows short numbered findings.

  factory/agent.sh critic                      open the saved Critic (agents/critic/agent.md, "## Job")
  factory/agent.sh repeater --job "Repeat Main's last prompt in at most five words, as one numbered finding."
  factory/agent.sh critic --model sonnet       another model (default: haiku)
  factory/agent.sh send main #2                queue finding 2 for Main; it is attached to your next prompt there,
                                               without interrupting Main or touching what you typed
  factory/agent.sh                             list saved agents
Needs the agent-feed hook (UserPromptSubmit + Stop) in .claude/settings.json and a Main that has had one prompt.
EOF
}

if [ $# -eq 0 ]; then
  echo "saved agents:"; for d in "$project"/agents/*/ "$project"/factory/agents/*/; do [ -f "$d/agent.md" ] && echo "  $(basename "$d")"; done; echo "(factory/agent.sh --help for usage)"; exit 0
fi
case $1 in -h|--help) usage; exit 0 ;; esac

if [ "$1" = send ]; then
  [ "${2:-}" = main ] || { echo "usage: factory/agent.sh send main #<n> [--agent <name>]"; exit 2; }
  n=${3#\#}; agent=${5:-}; [ "${4:-}" = --agent ] || agent=""
  [[ $n =~ ^[0-9]+$ ]] || { echo "finding number missing: factory/agent.sh send main #2"; exit 2; }
  hit=$(N="$n" AGENT="$agent" FEED="$feed" python3 -I - <<'PY'
import glob, json, os
n = int(os.environ["N"]); agent = os.environ["AGENT"]; feed = os.environ["FEED"]
files = [f"{feed}/findings-{agent}.jsonl"] if agent else sorted(glob.glob(f"{feed}/findings-*.jsonl"), key=os.path.getmtime, reverse=True)
for f in files:
    if not os.path.exists(f): continue
    for line in open(f):
        e = json.loads(line)
        if e["n"] == n:
            print(json.dumps(e)); raise SystemExit
raise SystemExit(f"no finding #{n}" + (f" from {agent}" if agent else ""))
PY
) || { echo "$hit"; exit 3; }
  mkdir -p "$feed"; printf '%s\n' "$hit" >> "$feed/queue-main.jsonl"
  echo "queued finding #$n for Main; it is attached to your next prompt there."
  exit 0
fi

name=$1; shift; job="" model=haiku extra=()
while [ $# -gt 0 ]; do
  case $1 in
    --job) job=$2; shift 2 ;;
    --model) model=$2; shift 2 ;;
    --main|--session) extra+=("$1" "$2"); shift 2 ;;
    --tmux) extra+=("$1"); shift ;;
    *) echo "unknown argument: $1 (see --help)"; exit 2 ;;
  esac
done
[[ $name =~ ^[A-Za-z0-9_-]+$ ]] || { echo "agent name: letters, digits, - and _ only"; exit 2; }
[ -n "$job" ] || [ -f "$project/agents/$name/agent.md" ] || [ -f "$project/factory/agents/$name/agent.md" ] || { echo "refuse: no agents/$name/agent.md and no --job"; exit 2; }
session=$(tail -1 "$feed/latest" 2>/dev/null || true)
[ -n "$session" ] || { echo "refuse: Main has not fed a prompt yet (is the agent-feed hook installed? send Main one prompt)"; exit 3; }
read -r backend pane < <("$here/split.sh" --print-pane "${extra[@]+"${extra[@]}"}") || { echo "refuse: cannot find Main's pane"; exit 4; }

argv=(env AGENT_ROLE="$name" AGENT_PROJECT="$project" node "$here/agent-run.mjs" "$name" "$session" --model "$model")
[ -n "$job" ] && argv+=(--job "$job")
if [ "$backend" = tmux ]; then
  tmux split-window -h -t "$pane" -c "$project" "$(printf '%q ' "${argv[@]}")"
else
  json=$(python3 -I -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "${argv[@]}")
  herdr-app do pane.split --direction right --pane "$pane" --argv "$json" >/dev/null
fi
echo "$name opened beside Main ($backend pane $pane), following session ${session:0:8}…, model $model."
