# System diff · <change name>

What changed in the system, not in the files: a reviewer reads this before the code diff.
Every "Shown by" names a file that was captured, not written; check with `node tools/evidence-check.mjs <this file>`.

## Summary
One or two sentences: what a user or operator notices.

## What changed
| Area | Before | After | Shown by |
|---|---|---|---|
| Behaviour (what users see) | | | `log/...` |
| Data (schema, stored values, migrations) | | | `log/...` |
| Architecture (new parts, new calls between parts) | | | `log/...` |
| Operations (config, secrets, schedules, cost) | | | `log/...` |

## Evidence
- Before: Shown by: `log/before-...` (captured on the base)
- After: Shown by: `log/after-...` (captured with the change)

## Merge danger
What breaks if this merges as is: callers of a changed answer, data written in the old shape, a running
schedule, another branch touching the same part. Name each, or say why there is none.

## Not checked
What nobody ran or looked at, and why. An empty section here is a claim too.
