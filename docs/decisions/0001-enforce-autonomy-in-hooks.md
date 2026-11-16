# 1. Enforce autonomy in a PreToolUse hook, not in the prompt

Status: accepted
Date: 2026-11-05

## Context
"Ask before every outward action" lived in the instructions. Under long sessions and permissive modes the
agent sometimes chained a push or a secret change into a larger command.

## Decision
A `PreToolUse` hook classifies every shell command: reads and local edits run alone, outward actions ask,
irreversible ones are refused. Quoted strings and heredoc bodies are stripped first, so text that only
mentions a command (e.g. an edit that writes "gh secret set" into a doc) does not trigger it.
Every ask/deny is appended to `log/autonomy.jsonl` with tokens masked.

## Consequences
+ The boundary holds regardless of prompt drift; the log is auditable evidence of what ran alone.
− Pattern-based: a novel outward tool needs a new pattern (and an eval case). In fully permissive modes
  the host may auto-approve "ask"; the log still records it.

## Notes
- 2026-11-16: the same hook now also runs on MCP tools (patterns in `hooks/outward-tools.json`) and asks on
  an HTTP write, inline scripts included, to a host not on that file's allowlist.
