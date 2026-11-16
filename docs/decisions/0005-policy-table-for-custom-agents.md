# 5. A policy table in code for agents we build

Status: accepted
Date: 2026-11-16

## Context
The outward guard ([ADR 1](0001-enforce-autonomy-in-hooks.md)) protects a coding agent's shell. Agents we
build ourselves (a bot that answers tickets, a runner that works while nobody watches) call their own tools,
so the guard never sees them, and their alone / ask / never line lived in their prompt. Two failures recur
there: an act nobody listed gets done because nothing said no, and the model decides what the request
"really" asks for and then acts on its own guess.

## Decision
`tools/policy.mjs` holds the line as data: a JSON table of named acts, each `alone`, `ask` or `never` with a
reason, and `gate(policy, act, { guessed })` that the agent calls before every act. Two rules sit in the code,
not in the table: an act the table does not name asks, and an act the model guessed (not named by the
request) is never done alone. A broken table is an error, never an empty table.

## Consequences
+ The boundary of a custom agent is reviewable in one file and testable without a model; changing it is a diff.
+ A forgotten act asks instead of running.
− Acts must be named consistently by the agent's code; a free-text act name misses its row and asks.
− The table says nothing about how an act is carried out; secrets and hosts need `tools/bound-fetch.mjs`.
