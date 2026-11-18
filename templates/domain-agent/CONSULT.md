# Consult before a feature that crosses areas

Paste this into Main with the feature, or run `node <harness>/factory/domain-brief.mjs consult "<feature>" --repo <this repo>`:

```
Before you edit anything for this feature, list the Domain Agents in agents/ whose areas it touches. Ask each of them, in
parallel and read-only, what in its memories and glossary this feature could collide with. Then show me their answers
side by side, name every point where two of them disagree or where the feature forces a product decision, and wait for my
answer. Do not pick an answer for me. After I answer, you write all the changes yourself, and you add the decision to
memories.md of every agent it concerns as one rule of one or two sentences with today's date and a receipt (commit, issue,
user report, or "decided in conversation" with the date). Never paste a transcript or a log into memories.
```

A collision between two Domain Agents is always the human's decision.
