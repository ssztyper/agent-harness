# 3. Remote workers run in CI, on another network

Status: accepted
Date: 2026-11-05

## Context
A task required one worker "elsewhere". A worker on an always-on box in the same home network was refused:
both workers reached the checker from the same provider network.

## Decision
Remote workers run in GitHub Actions via `workers/ci-worker/run.sh`: a private repo, the worker's MCP link
and agent token as short-lived secrets, the result returned as an artifact, then secrets, runs and
artifacts deleted. Before a run the script checks the link's shape, because a value cut at a colon once
cost a full CI run.

## Consequences
+ Independent network and machine; nothing sensitive left on GitHub after the run.
− A few minutes of CI latency; needs `gh` and a token the agent can run with.
