# factory: a small software factory around one focused conversation

A software factory replaces frictions in your development loop with agents. It does not start with a swarm; it starts
with one focused conversation (Main) and small, tested tools beside it. Everything here works with Claude Code and
either Herdr (`hc`, `herdr-app`) or plain tmux.

| Tool | What it does |
|---|---|
| `split.sh` | `/split`: fork Main into a new pane beside it with a split notice ("do not continue earlier work, act only on what I ask next"). Main gets no new turn. The split starts without project MCP servers, so it cannot call outward tools behind Main's back. |
| `lab.mjs` | `/lab`: black-box checks. `test <agent> --agent-model m` picks the agent's model; `climb <agent> --models haiku,sonnet` runs the same expectations once per model and writes a table to `log/lab-reports/climb-*.md`. A separate tmux server on a short `/tmp` socket, a stripped copy of the project (no `.git`, logs, secrets or the agents' own tests), and a Tester agent whose only tool is driving that lab. Every report line is "I tried X, expected Y, got Z" with a quote, and the script rejects any quote that was not on a screen the Tester read. |
| `agent.sh` + `agent-run.mjs` | `/agent`: a supporting agent beside Main on a small, fast model. It follows only Main, shows a verdict and at most three numbered findings, and sends nothing by itself; `agent.sh send main #2` queues one finding for Main's next prompt. |
| `agent-feed.mjs` | The hook (UserPromptSubmit + Stop) that feeds Main's prompts and finished replies to supporting agents and attaches queued findings once. Supporting agents never feed. |
| `agents/critic/` | A Critic with a Job and black-box expectations: asks for what the request leaves out, names what else a change touches, splits big tasks. |
| `agents/memories/` | A Memories agent: when the last exchange settles a lasting rule, it suggests exactly one line; nothing is written until you run `agent.sh keep #1`, which appends it to `KEEP.md` with its source (the Main session). |
| `agents/gatherer/` | Expectations for `workers/phone/gather.mjs` (the context brief before a delegated task), checked offline by `workers/phone/gather.test.mjs`. |
| `domain-brief.mjs` | Domain Agents: a read-only expert per area of a repo, in `<repo>/agents/<area>/` (`owns:` globs, `memories.md` with a receipt per line; template in `templates/domain-agent/`). A PreToolUse hook: when Main reads, edits or runs a shell command on an owned file, the agent runs once on its small model with no tools and its brief (at most five traps with references, or "nothing relevant") is added to Main's context. It never blocks, briefs once per agent per session, and logs each brief with its time and cost to `log/domain/briefs.jsonl`. `ask <agent> "<change>" --repo <dir>` asks by hand; `which <path>` shows the owner. Main stays the only writer. |

## Use

```bash
node factory/lab.mjs doctor                          # tmux, claude, a throwaway lab, clean stop
node factory/lab.mjs run factory/agents/lab-scenarios.md   # the lab works; /split carries over
node factory/lab.mjs test critic                     # grow an agent until its expectations pass
node factory/lab.mjs climb critic --models haiku,sonnet   # same expectations per model: keep the cheapest that passes
factory/agent.sh critic                              # bring it home: a pane beside Main
factory/agent.sh memories                            # suggests one memory per settled rule
factory/agent.sh keep #1                             # keep it: one line with its source in KEEP.md
factory/split.sh --name "idea" --focus "compare X"   # explore a tangent without spoiling Main
node factory/lab.mjs test billing --repo <repo>      # a Domain Agent of <repo>/agents/billing/ (repo copied into the lab)
node factory/domain-brief.mjs ask billing "<change>" --repo <repo>   # its brief by hand
```

The loop: notice a sore spot, write the expectations first, test the agent in the lab, bring it home.
Hill climbing: the expectations stay fixed while one thing changes, either the model (`climb --models`) or the
instructions (edit `agent.md` between two climbs); compare the tables and keep the cheapest version that passes.
Lab runs and supporting agents use model tokens. The lab runs as you on your machine: it is for tools you build, not
for untrusted code.

## Lessons that shaped it
- Many brains, one writer: Domain Agents only advise; a collision between two of them is the human's call, and the decision goes back into each agent's memories as one dated rule with a receipt.
- Seed memories from history (commits, issues, reviews), not from a long instruction file: every memory cites where the lesson was learned.
- An agent never grades its own code: the Tester only sees screens, and quotes are checked against them.
- A forked pane stops at the first question (an MCP approval dialog): start splits with `--strict-mcp-config`.
- `--mcp-config` takes several values and swallows a prompt placed after it: put the prompt first.
- `$TMUX` alone does not mean "the lab": session managers run the daily conversation in tmux too.
