#!/usr/bin/env bash
# Copy the harness into a project: hooks, tools, workers, schedules, evals, templates, the gated-contract
# and decision-record skills, hook settings and a CLAUDE.md template. Never overwrites an existing file; prints what it skipped.
# usage: ./install.sh <project dir>
set -euo pipefail
src=$(cd "$(dirname "$0")" && pwd); dst=${1:?usage: ./install.sh <project dir>}
[ -d "$dst" ] || { echo "$dst does not exist"; exit 2; }
copy() { if [ -e "$dst/$2" ]; then echo "skip  $2 (exists)"; else mkdir -p "$(dirname "$dst/$2")"; cp -R "$src/$1" "$dst/$2"; echo "add   $2"; fi; }
for d in hooks tools workers schedules evals templates factory; do copy "$d" "$d"; done
for s in gated-contract decision-record; do copy "skills/$s" ".claude/skills/$s"; done
copy .claude/settings.json .claude/settings.json
copy templates/CLAUDE.md CLAUDE.md
grep -qs '^log/' "$dst/.gitignore" || printf 'log/\ntasks/*/CONTRACT.md\n**/RESULT.json\n**/mcp.json\n' >> "$dst/.gitignore"
echo "done: fill the TODO lines in CLAUDE.md, then run: node tools/eval.mjs evals/harness.jsonl"
