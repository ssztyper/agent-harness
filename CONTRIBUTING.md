# Contributing

Every behaviour in this harness exists because something went wrong without it. Contributions follow the same loop.

1. **Start from a real failure.** Describe what an agent did, what it should have done, and why the harness
   did not stop it. Open an issue first for anything larger than a small fix.
2. **Put the fix in the cheapest layer that enforces it:** a hook or script before a prompt line, a gate
   before a note.
3. **Add one eval case** to `evals/harness.jsonl` that fails without your change and passes with it, and run
   `node tools/eval.mjs evals/harness.jsonl --baseline evals/harness.report.json`: no regressions.
4. **Keep it generic and small.** No product names, private hosts, personal paths or secrets; no new
   dependencies unless there is no other way.
5. Add a row to `docs/case-studies.md` when the change comes from a failure others can learn from.

Be kind in issues and reviews; assume good intent and argue with evidence.
