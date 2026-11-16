#!/usr/bin/env bash
# Runs one headless Claude worker in GitHub Actions (another network), waits, brings the result home, cleans up.
# usage: pbpaste | workers/ci-worker/run.sh <repo owner/name> <brief.md> <out dir> [extra files...]
#   stdin: the worker's MCP URL (it is a key: never an argument, never echoed).
# The repo must be private. Secrets: CLAUDE_CODE_OAUTH_TOKEN (from $CLAUDE_TOKEN_CMD, e.g. a command that prints
#   it on your always-on box) and MCP_URL.
# After the run it deletes both secrets, the run and its artifact, so nothing sensitive stays on GitHub.
# Every step that GitHub sees goes through the outward guard hook, so the human approves each one.
set -euo pipefail
repo=$1 brief=$2 out=$3; shift 3
here=$(cd "$(dirname "$0")" && pwd)
url=$(cat); [[ $url =~ ^https://[^[:space:]]+$ ]] || { echo "MCP URL on stdin does not look like a URL (${#url} chars)"; exit 2; }
[[ $(gh repo view "$repo" --json visibility -q .visibility 2>/dev/null) == PRIVATE ]] || { echo "$repo is missing or not private"; exit 2; }
work=$(mktemp -d)
cleanup() { gh secret delete MCP_URL -R "$repo" >/dev/null 2>&1 || true; gh secret delete CLAUDE_CODE_OAUTH_TOKEN -R "$repo" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT  # secrets are deleted even when the run fails half way
gh repo clone "$repo" "$work" -- -q
mkdir -p "$work/.github/workflows"; cp "$here/worker.yml" "$work/.github/workflows/worker.yml"; cp "$brief" "$work/BRIEF.md"
for f in "$@"; do cp -R "$f" "$work/"; done
printf 'mcp.json\n' > "$work/.gitignore"
git -C "$work" add -A && git -C "$work" commit -qm "ci worker: $(basename "$brief")" && git -C "$work" push -q
[[ -n ${CLAUDE_TOKEN_CMD:-} ]] || { echo "set CLAUDE_TOKEN_CMD to a command that prints the Claude token"; exit 2; }
sh -c "$CLAUDE_TOKEN_CMD" | gh secret set CLAUDE_CODE_OAUTH_TOKEN -R "$repo"
printf %s "$url" | gh secret set MCP_URL -R "$repo"
gh workflow run worker.yml -R "$repo"; sleep 8
id=$(gh run list -R "$repo" -w worker.yml -L1 --json databaseId -q '.[0].databaseId')
gh run watch "$id" -R "$repo" --exit-status >/dev/null || echo "run $id did not succeed"
mkdir -p "$out"; gh run download "$id" -R "$repo" -n result -D "$out" || echo "no artifact"
gh secret delete MCP_URL -R "$repo"; gh secret delete CLAUDE_CODE_OAUTH_TOKEN -R "$repo"
gh run delete "$id" -R "$repo" >/dev/null
echo "runner result in $out: $(ls "$out" | tr '\n' ' ')"
