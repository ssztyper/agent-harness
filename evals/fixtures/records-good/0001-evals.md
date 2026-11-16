# 1. One eval case per harness rule

Status: accepted
Date: 2026-11-05

## Context
Rules were added after failures, then silently lost or contradicted in later edits.

## Decision
`tools/eval.mjs` runs `evals/harness.jsonl` in CI. Each rule the harness learns adds one case that fails
without it; behavioural cases (guard decisions, red/green on fixtures) are preferred over text greps.
`--baseline` reports fixed and regressed cases between runs.

## Consequences
+ Removing or breaking a rule turns CI red; the review agent can cite failing cases.
− Text-grep cases prove a rule is written down, not that it is followed; they are a floor, not a ceiling.
