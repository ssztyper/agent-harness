# 2. One eval case per harness rule

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
+ `--repeat k` passes a case only when all k runs pass, so a flaky tool shows up as FLAKY instead of hiding
  behind one lucky run.
− Text-grep cases prove a rule is written down, not that it is followed; they are a floor, not a ceiling.
  They carry `"kind":"text"` and the runner counts them apart, so the share of behaviour cases is visible.
− `--repeat` multiplies run time; it is for tools with timing, network or randomness, not every CI run.
