# Case studies: failures and the rules they produced

Each row is a real refusal or snag from graded agent tasks, the layer the fix went into, and the eval or
check that now guards it. Task details are left out on purpose.

| What happened | Root cause | Fix (layer) | Guarded by |
|---|---|---|---|
| A submission was refused seven times; the task page had been updated mid-task | only the first part of a long page was read; answers were varied instead of re-reading | whole-source read + `recheck:` lines (Gate A, Stop hook) | `hooks/recheck-stop.mjs` |
| A count was refused because the checker counted with the system's own logic | counted with a private script, not the system's own component | counts come from the system's code (Gate A) | contract gate |
| An issue was closed before the reviewer looked; refused | "sent" treated as "reviewed" | nothing that waits on a person closes early (Gate C) | contract gate |
| A hosted endpoint was cut off by a short timeout, then a model call hung | no timed dry run with the real payload | timed dry run before submit; durable alarm + fallback model (Gate D) | contract gate |
| An agent-written test passed on the buggy base and was accepted anyway | no red/green proof for model-written tests | `tools/redgreen.mjs` mandatory (Gate D) | `redgreen-*` evals |
| An email agent answered a follow-up from an unrelated page | no thread history in context | replay real failed inputs before retrying (refusal step) | contract gate |
| A tool result went over the checker's byte limit; two errors were refused as unhelpful | text duplicated the JSON; errors did not name the input | measure limits like the checker; errors name input and cause (Gate D) | contract gate |
| A multi-megabyte file could not go through chat to a tool | bytes routed through the model | big files travel beside the model (instructions) | `CLAUDE.md` |
| Two workers were refused as one | the "remote" box shared the home network | remote workers run in CI ([ADR 3](decisions/0003-remote-workers-in-ci.md)) | contract gate |
| A CI worker got an invalid MCP link | a `sed` split the value at a colon in a timestamp | check key shape/length before a run (Gate B, CI worker script) | `workers/ci-worker/run.sh` |
| A sync copied worker links and receipts to a second machine | sync rules did not know the new file types | keys and receipts excluded from sync | sync eval (private project) |
| The guard asked on edits that only mentioned `gh secret set` | regex ran over quoted and heredoc text | strip quotes and heredocs before matching ([ADR 1](decisions/0001-enforce-autonomy-in-hooks.md)) | `guard-ignores-*` evals |
| An unattended agent relayed an owner's approval code with a typo (two zeros for two letters); the whole live try was refused | the agent trusted any text after "APPROVE"; practice messages had no reply format, live ones did | code shape check, refuse codes the request carried, one reply line per ask, model guesses always gated (contract gate, `tools/policy.mjs`) | `unattended-agent-rule`, `policy-*` evals |
| A batch run sent an API key to a "verify" host the manual named, and a write request followed a redirect to a third host; four runs were refused | the http client filled secrets for any host and followed redirects | secrets bound to hosts in code, no redirects, a document never adds a host (Gate B, `tools/bound-fetch.mjs`) | `secret-refused-for-unlisted-host`, `bound-fetch-fills-only-where-bound` evals |
| An agent ran a 20-task batch with a seconds-long limit by one model turn per task | model turns cost seconds each | one script does the batch; the model starts it and reports (Gate D) | `batch-as-script` eval |
| A free model echoed a stored secret by putting its reference into a URL | the tool filled references in URLs and bodies | references only in headers, values masked in replies, tool read-only (`tools/bound-fetch.mjs`) | `bound-fetch-fills-only-where-bound` eval |
| An unattended agent shipped an export that a signed decision record forbade | it read the contract, not the records | read every decision record before building; records have a checked shape (Gate B, `tools/records-check.mjs`) | `records-before-build`, `records-check-flags-missing-section` evals |
| A recording proved nothing because the click waited for the page to settle | test-style clicks miss races | record like a person; name expected and got (Gate D) | `person-like-recording` eval |
| A grouped analysis was refused seven times | each area was split over several groups; notes too long | one group per decision area, short notes, cite file + second + region (Gate D) | `one-group-per-area` eval |
| A weekly self-review and a local before/after eval loop earned no credit from the grader | the grader saw only the submissions, which never mentioned them | do the practice inside the task and quote its evidence in the submission (Gate D) | `evidence-inside-submission` eval |
| A reviewer role passed a config change because its own file held a copied, stale setting | the role trusted a snapshot of the settings | roles read facts and why-notes at every start; changes proven with a lab fixture and a before/after eval (Gate B) | `role-reads-fresh-facts` eval |

## Numbers from one week

- 9 graded tasks run through the gates; every refusal turned into at least one rule.
- First scheduled review: 7 rules proposed from past write-ups, all adopted, each with an eval case.
- Harness evals in the private project: 10 → 23 cases in one day, 0 regressions against baseline.
