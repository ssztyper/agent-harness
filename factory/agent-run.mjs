#!/usr/bin/env node
// The loop inside a supporting agent's pane: follows Main's feed and, after each finished reply of Main, asks a small,
// fast model to do the agent's Job over the latest exchange. Prints a short verdict and numbered findings (glanceable);
// sends nothing to Main by itself. Findings are kept in log/agent-feed/findings-<agent>.jsonl for `agent.sh send`.
// usage: node scripts/agent-run.mjs <agent> <main-session> [--model haiku] [--job "text"]
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [agent, session, ...rest] = process.argv.slice(2);
const opt = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : d; };
const model = opt('--model', 'haiku');
const project = process.env.AGENT_PROJECT || process.cwd();
const feedDir = join(project, 'log', 'agent-feed');
const feed = join(feedDir, `${session}.jsonl`);
const findingsFile = join(feedDir, `findings-${agent}.jsonl`);

function job() {
  const inline = opt('--job', '');
  if (inline) return inline;
  const f = [join(project, 'agents', agent, 'agent.md'), join(project, 'factory', 'agents', agent, 'agent.md')].find(existsSync) || join(project, 'agents', agent, 'agent.md');
  if (!existsSync(f)) { console.log(`no agents/${agent}/agent.md and no --job: nothing to do`); process.exit(2); }
  const m = readFileSync(f, 'utf8').match(/^## Job\s*\n([\s\S]*?)(?=^## |\s*$(?![\s\S]))/m);
  return (m ? m[1] : '').trim() || (console.log(`agents/${agent}/agent.md has no "## Job" section`), process.exit(2));
}
const JOB = job();
const entries = () => (existsSync(feed) ? readFileSync(feed, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

let seen = entries().length;
let n = existsSync(findingsFile) ? readFileSync(findingsFile, 'utf8').split('\n').filter(Boolean).length : 0;
console.log(`${agent} · watching Main (${session.slice(0, 8)}) · model ${model} · send one to Main: factory/agent.sh send main #<n>`);

function review(all) {
  const recent = all.slice(-6).map((e) => `${e.role === 'user' ? 'HUMAN' : 'MAIN'}: ${e.text}`).join('\n\n');
  const prompt = `You are "${agent}", a supporting agent beside a main coding conversation. You only watch; you never change files.
Your job:
${JOB}

The latest exchange in the main conversation:
${recent}

Answer in at most 4 short lines. First line: a verdict in at most 6 words. Then numbered findings "1. ...", at most 3, each one sentence, only if they matter. If nothing matters, write only "Nothing to flag."`;
  const r = spawnSync('claude', ['-p', prompt, '--model', model, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task'],
    { encoding: 'utf8', env: { ...process.env, AGENT_ROLE: agent }, timeout: 120000, cwd: '/tmp' });
  return (r.stdout || '').trim() || `(no answer: ${(r.stderr || '').slice(0, 120)})`;
}

for (;;) {
  const all = entries();
  if (all.length > seen) {
    const fresh = all.slice(seen);
    seen = all.length;
    if (fresh.some((e) => e.role === 'assistant')) { // review once Main has finished a reply
      const out = review(all);
      const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
      console.log(`\n── ${new Date().toTimeString().slice(0, 5)} ──`);
      for (const l of lines) {
        const m = l.match(/^(\d+)[.)]\s*(.+)$/);
        if (m) { n++; appendFileSync(findingsFile, JSON.stringify({ n, agent, text: m[2], at: new Date().toISOString() }) + '\n'); console.log(`#${n} ${m[2]}`); }
        else console.log(l);
      }
    }
  }
  spawnSync('sleep', ['2']);
}
