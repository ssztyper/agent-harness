---
name: decision-record
description: Write a decision record when a human makes a binding choice (an API shape, a feature kept or removed, what may be published, a trade-off). Use when the human decides something a later agent could undo by accident, or asks to record a decision. The agent proposes; only the human accepts.
---

# decision-record

A later agent removes what it does not understand. A record says why it is there, so it stays.

1. **Find the folder.** Use the project's records folder (`docs/decisions/` unless the project names
   another). Read every record in it first: a new choice may supersede an old one.
2. **Copy the template** `templates/decision-record.md` to `NNNN-short-title.md`, the next free number.
3. **Fill it from what was said.** Context quotes the facts and their source; Decision is one or two
   sentences and names who decided; Consequences lists both sides. Leave out what nobody said.
4. **Status stays `proposed`.** Only the human who owns the choice changes it to `accepted`, because a
   record an agent signed binds every later agent to the agent's guess.
5. **Superseding.** When the new record replaces an old one, set the old one's Status to
   `superseded by N` and add a dated line under its Notes. Never delete a record.
6. **Check:** `node tools/records-check.mjs <folder>` must exit 0. Then tell the human the file, the
   decision in one line, and that it waits for their accept.

An agent that builds from tickets treats an accepted record as binding and a proposed one as a question
for the owner, never as a reason to build.
