#!/usr/bin/env node
// Domain Agents path hook. PreToolUse for Read/Edit/Write/MultiEdit/NotebookEdit/Bash: when Main is
// about to touch a file that an agents/<name>/agent.md owns ("owns:" globs, relative to the folder that holds agents/),
// that Domain Agent runs once, headless, on its small model with no tools, and its brief (at most five lines of traps
// with references, or "nothing relevant") is added to Main's context. It never blocks the call, and it briefs each
// agent once per Main session (log/domain/<session>.json). Any repo with an agents/ folder is picked up: the nearest
// agents/ above the touched file wins.
//   hook:   node factory/domain-brief.mjs                       (stdin: the hook's JSON)
//   by hand: node factory/domain-brief.mjs ask <agent> "<change>" [--repo <dir>]
//            node factory/domain-brief.mjs consult "<feature>" [--repo <dir>]   (every agent at once, side by side)
//            node factory/domain-brief.mjs which <path>...       (which agents own these paths; no model call)
//            node factory/domain-brief.mjs reset <session>       (brief again in that session)
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = process.env.CLAUDE_PROJECT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = join(PROJECT, 'log', 'domain');
const FILE_TOOLS = { Read: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' };
const MAX_LINES = 5;

/** "owns:" globs and model from an agent.md's front matter, plus its Job. */
export function parseAgent(text) {
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  const owns = [];
  let inOwns = false;
  for (const line of front.split('\n')) {
    if (/^owns:\s*$/.test(line)) { inOwns = true; continue; }
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (inOwns && item) owns.push(item[1].replace(/^["']|["']$/g, ''));
    else if (!/^\s/.test(line)) inOwns = false;
  }
  const model = /^model:\s*(\S+)/m.exec(front)?.[1] ?? 'haiku';
  const job = /^## Job\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1].trim() ?? '';
  return { owns, model, job };
}

/** A glob (`**`, `*`, `?`) as a RegExp over a path with forward slashes. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** The agents of the nearest folder above `file` that holds agents/<name>/agent.md files. */
function agentsAbove(file) {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const agents = agentsOf(dir);
    if (agents.length) return agents;
    if (dirname(dir) === dir) return [];
  }
}

/** Every Domain Agent that owns `file` (absolute), with the path relative to its repo. */
export function owners(file) {
  return agentsAbove(file).flatMap((a) => {
    const rel = relative(a.root, file).split(sep).join('/');
    if (rel.startsWith('..') || rel.startsWith('agents/')) return [];
    return a.owns.some((g) => globToRegExp(g).test(rel)) ? [{ ...a, rel }] : [];
  });
}

/** Paths a tool call touches: the file tools' path, or the path-like words of a Bash command. */
export function pathsOf(tool, input, cwd) {
  const key = FILE_TOOLS[tool];
  if (key) return typeof input?.[key] === 'string' ? [resolve(cwd, input[key])] : [];
  if (tool !== 'Bash' || typeof input?.command !== 'string') return [];
  const words = input.command.match(/"[^"]*"|'[^']*'|[^\s;|&<>()]+/g) ?? [];
  return [...new Set(words.map((w) => w.replace(/^["']|["']$/g, '')).filter((w) => w.includes('/') && !/^[a-z]+:\/\//i.test(w) && !w.startsWith('-'))
    .map((w) => (isAbsolute(w) ? w : resolve(cwd, w))))];
}

/** Main's latest typed prompt from the transcript, cut to 1500 characters. */
function latestPrompt(transcript) {
  try {
    const lines = readFileSync(transcript, 'utf8').trim().split('\n').reverse();
    for (const l of lines) {
      const e = JSON.parse(l);
      const c = e.type === 'user' && !e.isMeta ? e.message?.content : null;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p.type === 'text').map((p) => p.text).join('\n') : '';
      if (text && !text.startsWith('<')) return text.slice(0, 1500);
    }
  } catch {}
  return '';
}

/** Runs the Domain Agent once on its model, no tools, no hooks, outside the project (no CLAUDE.md). */
export function knowledge(agent) {
  const read = (f) => (existsSync(join(agent.dir, f)) ? readFileSync(join(agent.dir, f), 'utf8') : '');
  const glossary = read('glossary.md');
  return (glossary ? `Your glossary (agents/${agent.name}/glossary.md):\n${glossary}\n\n` : '') +
    `Your memories (agents/${agent.name}/memories.md):\n${read('memories.md') || '(no memories.md yet)'}`;
}

/** One headless answer from the agent's model: no tools, no hooks, outside the project (no CLAUDE.md). */
export function answer(model, system, text, timeout = 50000) {
  const t0 = Date.now();
  const r = spawnSync('claude', ['-p', '--model', model, '--no-session-persistence', '--output-format', 'json',
    '--settings', '{"disableAllHooks":true}', '--strict-mcp-config', '--system-prompt', system, '--tools', '', '--', text],
  { cwd: tmpdir(), encoding: 'utf8', timeout, env: { ...process.env, DOMAIN_BRIEF_CHILD: '1' } });
  let j = {};
  try { j = JSON.parse(r.stdout); } catch {}
  const out = String(j.result ?? '').trim();
  return { text: out, ok: Boolean(out) && !j.is_error, ms: Date.now() - t0, cost: j.total_cost_usd ?? null, error: r.error?.message || (j.is_error ? j.subtype : '') || (out ? '' : (r.stderr || 'no answer').slice(0, 200)) };
}

export function brief(agent, change, prompt = '') {
  const ask = `${knowledge(agent)}\n\n` +
    (prompt ? `The main conversation's latest request:\n${prompt}\n\n` : '') +
    `${change}\n\nReply with at most ${MAX_LINES} lines: each a trap this change could hit, with its reference in square brackets as your memories give it. ` +
    `If nothing in your memories or glossary applies, reply exactly "nothing relevant". No preamble.`;
  const r = answer(agent.model, agent.job, ask);
  return { ...r, text: r.text.split('\n').filter((l) => l.trim()).slice(0, MAX_LINES).join('\n') };
}

/** Every Domain Agent of the repo at `root` (agents/<name>/agent.md with an "owns:" list). */
export function agentsOf(root) {
  const folder = join(root, 'agents');
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(folder, d.name, 'agent.md')))
    .map((d) => ({ name: d.name, root, dir: join(folder, d.name), ...parseAgent(readFileSync(join(folder, d.name, 'agent.md'), 'utf8')) }))
    .filter((a) => a.owns.length);
}

const record = (session) => join(LOG, `${String(session).replace(/[^\w-]/g, '_')}.json`);
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function logLine(entry) {
  mkdirSync(LOG, { recursive: true });
  appendFileSync(join(LOG, 'briefs.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

async function hook() {
  if (process.env.DOMAIN_BRIEF_CHILD) return;
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { return; }
  const cwd = input.cwd || process.cwd();
  const found = new Map();
  for (const p of pathsOf(input.tool_name, input.tool_input, cwd)) for (const o of owners(p)) if (!found.has(`${o.root}::${o.name}`)) found.set(`${o.root}::${o.name}`, o);
  if (!found.size) return;
  const recFile = record(input.session_id);
  const done = readJson(recFile, {});
  const todo = [...found.entries()].filter(([k]) => !done[k]);
  if (!todo.length) return;
  const prompt = latestPrompt(input.transcript_path);
  const out = [];
  for (const [key, a] of todo) {
    const verb = input.tool_name === 'Read' ? 'read' : input.tool_name === 'Bash' ? 'use in a shell command' : 'edit';
    const b = brief(a, `Main is about to ${verb} ${a.rel}, a file you own. Which of your memories matter for this?`, prompt);
    logLine({ session: input.session_id, agent: a.name, repo: a.root, path: a.rel, tool: input.tool_name, ok: b.ok, ms: b.ms, cost: b.cost, error: b.error || undefined, brief: b.text });
    if (!b.ok) continue;
    done[key] = { at: new Date().toISOString(), path: a.rel };
    out.push(`Domain Agent "${a.name}" (owns ${a.owns.join(', ')}) on ${a.rel}:\n${b.text}\nMore: node factory/domain-brief.mjs ask ${a.name} "<the change>" --repo ${a.root}`);
  }
  mkdirSync(LOG, { recursive: true });
  writeFileSync(recFile, JSON.stringify(done, null, 1));
  if (out.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: out.join('\n\n') } }));
}

/** The repo above `dir` that has Domain Agents. */
function repoAbove(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (agentsOf(d).length) return d;
    if (dirname(d) === d) return null;
  }
}

// consult: before a feature that crosses areas, every Domain Agent answers in parallel (read-only); Main shows the
// answers side by side, names where they disagree or where a product decision is needed, and waits for the human.
async function consult(args) {
  const i = args.indexOf('--repo');
  const repo = repoAbove(i >= 0 ? args.splice(i, 2)[1] : process.cwd());
  if (!repo) { console.log('no repo with agents/<name>/agent.md here; pass --repo <dir>'); return 2; }
  const feature = args.join(' ');
  const self = fileURLToPath(import.meta.url);
  const runs = agentsOf(repo).map((a) => new Promise((done) => {
    const c = spawn(process.execPath, [self, 'ask', a.name, feature, '--repo', repo], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', () => done(`## ${a.name}\n${out.trim()}`));
  }));
  console.log(`# Consult: ${feature}\n\n${(await Promise.all(runs)).join('\n\n')}\n\n` +
    'Next (Main): name every point where two agents disagree or where the feature forces a product decision, ask the human, and wait. ' +
    'After the answer, Main writes all the changes and adds the decision to each agent\'s memories.md as one dated rule with a receipt.');
  return 0;
}

function cli(cmd, args) {
  if (cmd === 'consult') return consult(args);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  if (cmd === 'which') {
    for (const p of args) {
      const os = owners(resolve(p));
      console.log(`${p}: ${os.length ? os.map((o) => `${o.name} (${o.rel})`).join(', ') : 'no Domain Agent'}`);
    }
    return 0;
  }
  if (cmd === 'reset') {
    rmSync(record(args[0] ?? ''), { force: true });
    console.log(`briefs reset for session ${args[0]}`);
    return 0;
  }
  if (cmd === 'ask') {
    const repo = resolve(opt('--repo') ?? process.cwd());
    const [name, ...rest] = args;
    let a;
    for (let dir = repo; !a; dir = dirname(dir)) {
      const f = join(dir, 'agents', name ?? '', 'agent.md');
      if (name && existsSync(f)) a = { name, root: dir, dir: dirname(f), ...parseAgent(readFileSync(f, 'utf8')) };
      else if (dirname(dir) === dir) break;
    }
    if (!a) { console.log(`no agents/${name}/agent.md above ${repo}; pass --repo <dir>`); return 2; }
    const b = brief(a, `Review this change for me: ${rest.join(' ') || '(no change given)'}`);
    logLine({ session: 'ask', agent: a.name, repo: a.root, ok: b.ok, ms: b.ms, cost: b.cost, error: b.error || undefined, brief: b.text });
    console.log(b.ok ? b.text : `no brief: ${b.error}`);
    console.log(`(${a.model}, ${(b.ms / 1000).toFixed(1)} s, ${b.cost ?? '?'} USD)`);
    return b.ok ? 0 : 1;
  }
  console.log('usage: node factory/domain-brief.mjs [ask <agent> "<change>" [--repo <dir>] | which <path>... | reset <session>]  (no args: PreToolUse hook)');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd) process.exitCode = await cli(cmd, args);
  else await hook().catch((e) => logLine({ error: `hook: ${e.message}` }));
}
