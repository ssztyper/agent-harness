# phone: delegate work to an always-on box and decide from your phone

Notifications alone are not enough: you get a push, but you cannot jump into the session or answer the question
it is about. These scripts close that gap with [Moshi](https://getmoshi.app) (`moshi-hook`) on the box that runs your agents.

| Script | What it does |
|---|---|
| `delegate.sh [--no-gather] <name> "<task>"` | Starts the task as its own agent session (agent-deck, in tmux), so the phone app lists it with its status and you can jump in; sends one "Delegated" card. First it runs `gather.mjs` and puts its brief and `rules.md` in front of the task: the session's first step is a plan and questions via `decide.sh`, no file changed before the answer. The brief tells the agent to ask decisions with `decide.sh` and wrap long runs in `job.sh`. |
| `gather.mjs "<task>" [--plan] [--planner rules\|haiku]` | Read-only context brief for a task: a planner picks only the gatherers it needs (code, history, decisions, past sessions, GitHub), and every line names a source (file:line, commit, issue url, session file:line) or says "(no source: assumption)". Secret-shaped text and secrets files are never quoted. `node workers/phone/gather.test.mjs` checks it offline. |
| `rules.md` | The terms for a delegated task: plan and questions first, a source for every claim, stop rule, `DONE:` / `STOPPED:` line. Edit it to fit your project. |
| `decide.sh [--url <link>] [--check "<cmd>"] "<question>" <opt> <opt>...` | Asks the human on the phone and prints the chosen option; the agent blocks until an answer, a timeout or "unreachable" (exit 4). The card stays under 256 characters; the full text and `--url` go to the inbox and to `links.sh`. `--check` must pass after the first option ("Ready"), or the card comes back once (exit 5 if still failing). `--require-remote`: only the phone can approve. Every decision is logged to `log/decisions.jsonl`. |
| `job.sh "<title>" <command...>` | Runs a long command as one live row on the phone (start, progress, end) instead of many pushes. |
| `set-var.sh <vars.json> <NAME>` | Puts one secret into a vars file from the phone's terminal: the value is read hidden (paste it), only its length is printed, the file is mode 600. Cards never carry secrets. |
| `links.sh [n]` | The last links that cards asked you to open, one per line, for the phone's terminal, where a link can be tapped or copied. |

## Phone access to the box
- Pair the phone with `moshi-hook host setup --host <addr> --port <port> --user <user>`, run only in your own terminal:
  the QR code and link it prints grant SSH access, so they must never land in an agent's output, a log or a chat.
- Pairing writes the phone's key to `~/.ssh/authorized_keys`; sshd must read that file too, e.g.
  `AuthorizedKeysFile /etc/ssh/agent_authorized_keys .ssh/authorized_keys`.
- After a config change, reload sshd (`pkill -HUP -o -x sshd` when sshd is PID 1 in a container), or the old config
  stays live. Symptom: `Connection closed by authenticating user ... [preauth]`.
- Away from home, reach the box through a private overlay network (e.g. Tailscale). If the box runs Tailscale in
  userspace mode (no UDP, only forwarded TCP), advertise its LAN address as a /32 subnet route and keep that address in
  the phone app: everything works as at home, Mosh included; a single forwarded SSH port logs in, but the app's
  terminal may not open.

## Lessons that shaped it
- A Ready pressed before the work is done proves nothing: every Ready card gets a `--check`.
- Cards cut text at 256 characters and cannot open or copy links: details and links go to the inbox and `links.sh`.
- Inbox entries from scripts (`ext-*` sessions in the app) have no pane to enter; run scheduled agents inside tmux
  (`schedules/stream-view.mjs` shows a `claude -p --output-format stream-json` run there live, masked).
- Multiple-choice cards may show only Approve / Deny in the phone app; `decide.sh` therefore asks one yes/no card per
  option (Approve = choose this, Deny = next) unless `MOSHI_OPTIONS=1`.
- A daemon installed from a root-owned path cannot update itself; run a user-owned copy (`~/.local/bin`) from your own
  service script, and point the scripts at it (`MOSHI=`).
- A session restarted on the box resumes its old conversation: tell it the current state, and have it re-check its
  task list before doing anything.
- Start delegated sessions with the project already trusted, or the first thing they show is a trust question.
