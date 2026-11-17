# phone: delegate work to an always-on box and decide from your phone

Notifications alone are not enough: you get a push, but you cannot jump into the session or answer the question
it is about. These scripts close that gap with [Moshi](https://getmoshi.app) (`moshi-hook`) on the box that runs your agents.

| Script | What it does |
|---|---|
| `delegate.sh <name> "<task>"` | Starts the task as its own agent session (agent-deck, in tmux), so the phone app lists it with its status and you can jump in; sends one "Delegated" card. The brief tells the agent to ask decisions with `decide.sh` and wrap long runs in `job.sh`. |
| `decide.sh "<question>" <opt> <opt>...` | Asks the human on the phone and prints the chosen option; the agent blocks until an answer, a timeout or "unreachable" (exit 4). `--require-remote`: only the phone can approve. Every decision is logged to `log/decisions.jsonl`. |
| `job.sh "<title>" <command...>` | Runs a long command as one live row on the phone (start, progress, end) instead of many pushes. |

## Lessons that shaped it
- Multiple-choice cards may show only Approve / Deny in the phone app; `decide.sh` therefore asks one yes/no card per
  option (Approve = choose this, Deny = next) unless `MOSHI_OPTIONS=1`.
- A daemon installed from a root-owned path cannot update itself; run a user-owned copy (`~/.local/bin`) from your own
  service script, and point the scripts at it (`MOSHI=`).
- A session restarted on the box resumes its old conversation: tell it the current state, and have it re-check its
  task list before doing anything.
- Start delegated sessions with the project already trusted, or the first thing they show is a trust question.
