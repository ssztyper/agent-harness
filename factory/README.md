# factory: a small software factory around one focused conversation

A software factory replaces frictions in your development loop with agents. It does not start with a swarm; it starts
with one focused conversation (Main) and small, tested tools beside it. Everything here works with Claude Code and
either Herdr (`hc`, `herdr-app`) or plain tmux.

| Tool | What it does |
|---|---|
| `split.sh` | `/split`: fork Main into a new pane beside it with a split notice ("do not continue earlier work, act only on what I ask next"). Main gets no new turn. The split starts without project MCP servers, so it cannot call outward tools behind Main's back. |
| `lab.mjs` | `/lab`: black-box checks. A separate tmux server on a short `/tmp` socket, a stripped copy of the project (no `.git`, logs, secrets or the agents' own tests), and a Tester agent whose only tool is driving that lab. Every report line is "I tried X, expected Y, got Z" with a quote, and the script rejects any quote that was not on a screen the Tester read. |
| `agent.sh` + `agent-run.mjs` | `/agent`: a supporting agent beside Main on a small, fast model. It follows only Main, shows a verdict and at most three numbered findings, and sends nothing by itself; `agent.sh send main #2` queues one finding for Main's next prompt. |
| `agent-feed.mjs` | The hook (UserPromptSubmit + Stop) that feeds Main's prompts and finished replies to supporting agents and attaches queued findings once. Supporting agents never feed. |
| `agents/critic/` | A Critic with a Job and black-box expectations: asks for what the request leaves out, names what else a change touches, splits big tasks. |

## Use

```bash
node factory/lab.mjs doctor                          # tmux, claude, a throwaway lab, clean stop
node factory/lab.mjs run factory/agents/lab-scenarios.md   # the lab works; /split carries over
node factory/lab.mjs test critic                     # grow an agent until its expectations pass
factory/agent.sh critic                              # bring it home: a pane beside Main
factory/split.sh --name "idea" --focus "compare X"   # explore a tangent without spoiling Main
```

The loop: notice a sore spot, write the expectations first, test the agent in the lab, bring it home.
Lab runs and supporting agents use model tokens. The lab runs as you on your machine: it is for tools you build, not
for untrusted code.

## Lessons that shaped it
- An agent never grades its own code: the Tester only sees screens, and quotes are checked against them.
- A forked pane stops at the first question (an MCP approval dialog): start splits with `--strict-mcp-config`.
- `--mcp-config` takes several values and swallows a prompt placed after it: put the prompt first.
- `$TMUX` alone does not mean "the lab": session managers run the daily conversation in tmux too.
