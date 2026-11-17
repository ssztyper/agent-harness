# phone: delegate work to an always-on box and decide from your phone

Notifications alone are not enough: you get a push, but you cannot jump into the session or answer the question
it is about. These scripts close that gap with [Moshi](https://getmoshi.app) (`moshi-hook`) on the box that runs your agents.

| Script | What it does |
|---|---|
| `delegate.sh [--no-gather] <name> "<task>"` | Starts the task as its own agent session (agent-deck, in tmux), so the phone app lists it with its status and you can jump in; sends one "Delegated" card. First it runs `gather.mjs` and puts its brief and `rules.md` in front of the task: the session's first step is a plan and questions via `decide.sh`, no file changed before the answer. The brief tells the agent to ask decisions with `decide.sh` and wrap long runs in `job.sh`. |
| `gather.mjs "<task>" [--plan] [--planner rules\|haiku]` | Read-only context brief for a task: a planner picks only the gatherers it needs (code, history, decisions, past sessions, GitHub), and every line names a source (file:line, commit, issue url, session file:line) or says "(no source: assumption)". Secret-shaped text and secrets files are never quoted. `node workers/phone/gather.test.mjs` checks it offline. |
| `rules.md` | The terms for a delegated task: plan and questions first, a source for every claim, stop rule, `DONE:` / `STOPPED:` line. Edit it to fit your project. |
| `decide.sh "<question>" <opt> <opt>...` | Asks the human on the phone and prints the chosen option; the agent blocks until an answer, a timeout or "unreachable" (exit 4). `--require-remote`: only the phone can approve. Every decision is logged to `log/decisions.jsonl`. |
| `job.sh "<title>" <command...>` | Runs a long command as one live row on the phone (start, progress, end) instead of many pushes. |

## Phone access to the box
- Pair the phone with `moshi-hook host setup --host <addr> --port <port> --user <user>`, run only in your own terminal:
  the QR code and link it prints grant SSH access, so they must never land in an agent's output, a log or a chat.
- Pairing writes the phone's key to `~/.ssh/authorized_keys`; sshd must read that file too, e.g.
  `AuthorizedKeysFile /etc/ssh/agent_authorized_keys .ssh/authorized_keys`.
- After a config change, reload sshd (`pkill -HUP -o -x sshd` when sshd is PID 1 in a container), or the old config
  stays live. Symptom: `Connection closed by authenticating user ... [preauth]`.
- Away from home, use the box's address on a private overlay network (e.g. Tailscale), not its LAN address.

## Lessons that shaped it
- Multiple-choice cards may show only Approve / Deny in the phone app; `decide.sh` therefore asks one yes/no card per
  option (Approve = choose this, Deny = next) unless `MOSHI_OPTIONS=1`.
- A daemon installed from a root-owned path cannot update itself; run a user-owned copy (`~/.local/bin`) from your own
  service script, and point the scripts at it (`MOSHI=`).
- A session restarted on the box resumes its old conversation: tell it the current state, and have it re-check its
  task list before doing anything.
- Start delegated sessions with the project already trusted, or the first thing they show is a trust question.
