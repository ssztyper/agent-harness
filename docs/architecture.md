# Architecture

## Layers

| Layer | Lives in | Enforces | Fails how |
|---|---|---|---|
| Hooks | `hooks/`, wired in `.claude/settings.json` | autonomy for shell and MCP tools (PreToolUse), re-reading sources (Stop) | closed: an outward command without a yes does not run |
| Tools | `tools/` | evidence (evals, red/green, evidence and record checks, session logs); limits for agents you build (policy table, bound secrets, outbox) | exit code ≠ 0, saved report; a refusal instead of a request |
| Skill gates | `skills/gated-contract/` | order of work, stop conditions, what counts as done | the agent stops and names the unchecked condition |
| Instructions | `CLAUDE.md` | defaults and reasons | soft; anything important is also in a lower layer |
| Schedules | `schedules/` | ambient review without a prompt | proposal file + notification; never edits |

## Task lifecycle

1. **Read (Gate A).** Whole source read, attachments saved, the task restated with quotes:
   *Outcome* (end state in the world), *Deliverable*, *Where it goes*, *How it is checked*.
   Volatile sources get `recheck:` lines.
2. **Plan (Gate B).** Steps with inputs, outputs and stop conditions. Each worker gets a brief and only
   the access its step needs. An autonomy table states what runs alone, what asks, what never runs.
3. **Outward (Gate C).** Each push, secret, issue, deploy or POST is asked by the guard hook and logged.
4. **Submit (Gate D).** Sources re-read; the outcome checked live; measured limits checked on real output;
   evals and red/green pass.
5. **Refusal.** Record the exact text; re-read before changing anything; replay real failed inputs; change
   one thing per try.
6. **Improve.** Each snag becomes a rule in the layer that would have stopped it, plus an eval case.

## Delegation

```
main agent ──brief + MCP link──▶ worker (headless, strict MCP config, allow-listed tools)
     ▲                                  │
     └──────── RESULT.json + receipt ◀──┘   (local file, or CI artifact for remote workers)
```

- Workers never see the main agent's context or other workers' links.
- The main agent validates every result file itself (headless workers often cannot run checks), scrubs
  personal data the worker read, and only then joins results.
- Joins normalize first (time zones, units, ids). A wall-clock match across two clocks is the classic trap.

## Self-improvement loop

```
failure ─▶ SOLUTION.md ─▶ rule (+reason, +source) ─▶ eval case ─▶ eval run vs baseline ─▶ keep
   ▲                                                                                        │
   └──────────── weekly review agent reads recent failures and proposes rules ◀─────────────┘
```

The review agent is read-only and writes a proposal; a human accepts. Accepted rules land with an eval case,
so a later edit that drops the rule turns CI red.
