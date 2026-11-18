#!/usr/bin/env node
// Scenario check for Domain Agents (Markdown has no compiler). For each "## " block of agents/<name>/scenarios.md
// (Ask / Expect / Never), the agent answers fresh on its small model from its glossary and memories, and a second
// model judges the answer against the Expect and Never lines; a failed scenario runs once more and fails only twice.
// Prints PASS or FAIL per scenario with the answer quoted, and exits 1 when any scenario fails, so a pre-commit hook or CI can stop on it.
//   node factory/domain-check.mjs [agent] [--repo <dir>] [--judge sonnet]
//   node factory/domain-check.mjs install-hook --repo <dir>   (pre-commit: runs the check only when staged files touch agents/)
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentsOf, knowledge } from './domain-brief.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const repo = resolve(opt('--repo', process.cwd()));
const judgeModel = opt('--judge', 'sonnet');
const [cmd] = args;

/** Scenarios of one agent: [{ title, ask, expect, never }]. */
export function scenarios(text) {
  return text.split(/^## /m).slice(1).map((b) => {
    const [head, ...lines] = b.split('\n');
    const field = (k) => lines.find((l) => l.startsWith(`${k}:`))?.slice(k.length + 1).trim() ?? '';
    return { title: head.trim(), ask: field('Ask'), expect: field('Expect'), never: field('Never') };
  }).filter((s) => s.ask && s.expect);
}

function claude(model, system, text) {
  return new Promise((done) => {
    const c = spawn('claude', ['-p', '--model', model, '--no-session-persistence', '--output-format', 'json',
      '--settings', '{"disableAllHooks":true}', '--strict-mcp-config', '--system-prompt', system, '--tools', '', '--', text],
    { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DOMAIN_BRIEF_CHILD: '1' } });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    const timer = setTimeout(() => c.kill(), 90000);
    c.on('close', () => {
      clearTimeout(timer);
      try { const j = JSON.parse(out); done({ text: String(j.result ?? '').trim(), cost: j.total_cost_usd ?? 0 }); } catch { done({ text: '', cost: 0 }); }
    });
  });
}

async function check(agent, sc) {
  const a = await claude(agent.model, agent.job, `${knowledge(agent)}\n\nQuestion: ${sc.ask}\nAnswer in one or two sentences, from your glossary and memories only.`);
  const verdict = await claude(judgeModel, 'You judge one answer against a rubric. Reply with JSON only.',
    `Question: ${sc.ask}\nAnswer: ${a.text || '(no answer)'}\n\nExpect: ${sc.expect}\nNever: ${sc.never || '(none)'}\n\n` +
    'The answer passes when it says what Expect says (other words are fine) and says nothing that Never forbids. ' +
    'Reply exactly {"pass": true|false, "why": "<one short sentence>"}.');
  let j = {};
  try { j = JSON.parse(verdict.text.slice(verdict.text.indexOf('{'), verdict.text.lastIndexOf('}') + 1)); } catch {}
  return { agent: agent.name, title: sc.title, pass: j.pass === true && Boolean(a.text), why: j.why ?? `judge gave no verdict: ${verdict.text.slice(0, 120)}`, answer: a.text, cost: a.cost + verdict.cost };
}

async function main() {
  const agents = agentsOf(repo).filter((a) => !cmd || a.name === cmd);
  if (!agents.length) { console.log(`no Domain Agent ${cmd ?? ''} in ${repo}/agents`); return 2; }
  const jobs = agents.flatMap((a) => {
    const f = join(a.dir, 'scenarios.md');
    // A model-judged check can miss once; a scenario fails only when a fresh second run fails too (shown as flaky otherwise).
    return existsSync(f) ? scenarios(readFileSync(f, 'utf8')).map(async (sc) => {
      const first = await check(a, sc);
      if (first.pass) return first;
      const again = await check(a, sc);
      return again.pass ? { ...again, why: `flaky: first run failed (${first.why}); second passed`, cost: first.cost + again.cost } : { ...again, cost: first.cost + again.cost };
    }) : [];
  });
  if (!jobs.length) { console.log('no scenarios.md with Ask/Expect blocks'); return 2; }
  const results = await Promise.all(jobs);
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.agent} · ${r.title} — ${r.why}\n     answer: "${r.answer.replace(/\s+/g, ' ').slice(0, 300)}"`);
  const failed = results.filter((r) => !r.pass).length;
  const cost = results.reduce((s, r) => s + r.cost, 0);
  console.log(`${results.length - failed}/${results.length} scenarios pass · judge ${judgeModel} · ${cost.toFixed(4)} USD`);
  return failed ? 1 : 0;
}

function installHook() {
  const hooks = join(repo, '.git', 'hooks');
  if (!existsSync(join(repo, '.git'))) { console.log(`${repo} is not the top of a git repo`); return 2; }
  mkdirSync(hooks, { recursive: true });
  const self = fileURLToPath(import.meta.url);
  writeFileSync(join(hooks, 'pre-commit'), `#!/bin/sh
# Domain Agents: run the scenario check only when this commit changes files under agents/ (written by domain-check.mjs).
git diff --cached --name-only | grep -q '^agents/' || exit 0
echo "agents/ changed: running the Domain Agent scenario check"
exec node ${JSON.stringify(self)} --repo "$(git rev-parse --show-toplevel)"
`);
  chmodSync(join(hooks, 'pre-commit'), 0o755);
  console.log(`pre-commit hook written: ${relative(process.cwd(), join(hooks, 'pre-commit'))}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = cmd === 'install-hook' ? installHook() : await main();
}
