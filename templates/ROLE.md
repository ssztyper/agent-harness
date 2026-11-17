# Role: <name>

<One sentence: what this role does and what it never does.>

## Purpose

<One job per role, so its output is easy to judge.>

## Startup reads (every start, before any decision)

1. The CURRENT facts from their source (settings, prices, limits), e.g. `GET <api>/settings`. Never trust a value
   copied into this file, a commit message or the input itself.
2. The why-notes: the decisions the code makes on purpose and what must not change (e.g. a `why/` folder).
3. The input to work on.

## How to decide

- <Rules in plain words, each with its reason. A value that differs from the current facts is flagged, not trusted.>

## Tools

- <Only the tools this role needs. A tool that is not here cannot be used: that is the strongest limit.>

## Limits

- <What it must not do. Prefer leaving the tool out over a sentence here.>

## Output

<Exactly what it hands back, and that it sends it once.>

<!-- Change this role only from one of its own failures: keep a lab fixture (recorded inputs + expected output),
run an eval before and after (`node tools/eval.mjs <cases> --baseline <before>`), keep the change only when the
report shows fixed and no regressed. -->
