#!/usr/bin/env bash
# /split for Claude Code + Herdr: branch the running Main conversation into a new pane beside it.
# Main gets no new turn: run this from a shell (Herdr key binding, another pane, or `! factory/split.sh` only if you
# accept that the output lands in Main). Claude Code cannot branch at a chosen message, so the WHOLE conversation is
# forked (`--resume <id> --fork-session`), and the split notice goes in as the new session's first message.
# The split starts with no project MCP servers (`--strict-mcp-config`): no approval dialog blocks it, and a research
# branch cannot call outward tools (deploys, uploads) behind Main's back. The prompt goes BEFORE the flags, because
# --mcp-config takes several values and would swallow it.
# usage: factory/split.sh [--name "title"] [--focus "what to explore"] [--main tN] [--session <uuid>] [--dry-run] [--help]
set -euo pipefail

usage() {
  cat <<'EOF'
split.sh: fork the running Main conversation into a new Herdr pane beside it (Main is not touched).

  --name "Calendar idea"   title of the new pane (default: split-HHMM)
  --focus "compare X"      what the split should look at first (added to the notice)
  --main t3                Main's Herdr terminal, when it cannot be found alone
  --session <uuid>         Main's Claude session id (default: newest session of this project)
  --tmux                   split the current tmux pane instead of Herdr (automatic inside the lab)
  --dry-run                print what would run, open nothing
  --help                   this guide

Examples:
  factory/split.sh --name "Pricing research" --focus "how other rental apps show minimum stays"
  factory/split.sh --dry-run
Limits: Claude Code forks the whole conversation, not up to a chosen message. The split should research, not edit
files Main is editing; save findings with "save this as one HTML page in .notes/".
EOF
}

name="split-$(date +%H%M)" focus="" main="" session="" dry=0
while [ $# -gt 0 ]; do
  case $1 in
    --name) name=$2; shift 2 ;;
    --focus) focus=$2; shift 2 ;;
    --main) main=$2; shift 2 ;;
    --session) session=$2; shift 2 ;;
    --dry-run) dry=1; shift ;;
    --tmux) use_tmux=1; shift ;;
    --print-pane) print_pane=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)"; exit 2 ;;
  esac
done

project=$(pwd -P)
slug=$(printf %s "$project" | sed 's#[/.]#-#g')
sessions="$HOME/.claude/projects/$slug"

# Main's session: given, or the newest top-level transcript of this project.
if [ -z "$session" ]; then
  newest=$(ls -t "$sessions"/*.jsonl 2>/dev/null | head -1 || true)
  [ -n "$newest" ] || { echo "refuse: no Claude session found for $project (pass --session)"; exit 3; }
  session=$(basename "$newest" .jsonl)
fi
[[ $session =~ ^[0-9a-f-]{36}$ ]] || { echo "refuse: '$session' is not a session id"; exit 3; }

# In the lab (LAB_ID set) or with --tmux: split the current tmux pane instead of touching Herdr. Plain $TMUX is not
# enough, because agent-deck runs the daily Main inside tmux too.
if { [ -n "${LAB_ID:-}" ] || [ "${use_tmux:-0}" = 1 ]; } && [ -n "${TMUX_PANE:-}" ]; then backend=tmux; pane=$TMUX_PANE; else backend=herdr; fi

# Main's pane: given terminal, our own terminal, or the only Claude terminal whose folder is this project.
if [ $backend = herdr ] && [ -z "$main" ] && [ -n "${HC_TERMINAL_ID:-}" ]; then main=$HC_TERMINAL_ID; fi
[ $backend = tmux ] || layout=$(herdr-app ls 2>/dev/null) || { echo "refuse: Herdr window not reachable (herdr-app ls failed)"; exit 4; }
[ $backend = tmux ] || pane=$(LAYOUT="$layout" MAIN="$main" PROJECT="$project" python3 -I - <<'PY'
import json, os, subprocess, sys
d = json.loads(os.environ["LAYOUT"]); main = os.environ["MAIN"]; project = os.environ["PROJECT"]
terms = [t for s in d["spaces"] for tab in s["tabs"] for t in tab["terminals"]]
if main:
    hit = [t for t in terms if t["terminal"] == main]
else:
    hit = []
    for t in terms:
        if t.get("app") != "claude-code":
            continue
        try:
            info = json.loads(subprocess.run(["hc", "get", t["terminal"], "--json"], capture_output=True, text=True, timeout=10).stdout)
        except Exception:
            continue
        cwd = (info.get("foreground") or {}).get("cwd") or info.get("cwd")
        if cwd and os.path.realpath(cwd) == project:
            hit.append(t)
if len(hit) != 1:
    sys.exit(f"refuse: found {len(hit)} candidate Main panes for {project}; pass --main tN")
print(hit[0]["pane"])
PY
) || { echo "$pane"; exit 5; }

if [ "${print_pane:-0}" = 1 ]; then echo "$backend $pane"; exit 0; fi  # used by agent.sh

notice="SPLIT NOTICE: this conversation was split from another conversation that is still running (Main). \
Do not continue any earlier work or plans from the history above. Expect Main to be changing files in this folder; \
do not edit files Main may be editing. Act only on what I ask next.${focus:+ First focus: $focus.} \
Reply only with one line confirming you understood, then wait."

argv=$(EMPTY_MCP='{"mcpServers":{}}' SESSION="$session" NOTICE="$notice" PROJECT="$project" python3 -I -c '
import json, os, shlex
cmd = "cd " + shlex.quote(os.environ["PROJECT"]) + " && exec claude " + shlex.quote(os.environ["NOTICE"]) + " --resume " + os.environ["SESSION"] + " --fork-session --strict-mcp-config --mcp-config " + shlex.quote(os.environ["EMPTY_MCP"])
print(json.dumps(["/bin/zsh", "-lc", cmd]))')

if [ $dry = 1 ]; then
  echo "backend:   $backend"; echo "main pane: $pane"; echo "session:   $session (whole conversation forked)"; echo "name:      $name"
  echo "would run: herdr-app do pane.split --direction right --pane $pane --argv '$argv'"
  exit 0
fi
if [ $backend = tmux ]; then
  cmd=$(ARGV="$argv" python3 -I -c 'import json,os,shlex; print(" ".join(shlex.quote(a) for a in json.loads(os.environ["ARGV"])))')
  tmux split-window -h -t "$pane" -c "$project" "$cmd"
else
  herdr-app do pane.split --direction right --pane "$pane" --argv "$argv" >/dev/null
fi
echo "split '$name' opened right of Main (pane $pane), forked from session ${session:0:8}…; Main untouched."
