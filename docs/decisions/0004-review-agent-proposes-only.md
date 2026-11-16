# 4. The scheduled review agent proposes, a human decides

Status: accepted
Date: 2026-11-05

## Context
Self-improvement without oversight drifts: an agent that edits its own rules can delete the ones that
constrain it.

## Decision
`schedules/harness-review.sh` runs weekly by cron. It runs the evals, then a read-only agent (Read/Glob/Grep
only) reads recent failure write-ups and outputs a proposal: rules to add (each with location, reason,
source and an eval case), rules to merge or remove, failing evals. The script saves stdout to a dated file
and notifies. It never writes elsewhere.

## Consequences
+ Ambient, unprompted improvement with a human gate; every accepted rule arrives with its test.
− Proposals wait for a human; a week can pass before a lesson lands.
