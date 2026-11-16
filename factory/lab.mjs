#!/usr/bin/env node
// /lab: a black-box lab for tools and supporting agents we build An agent never grades its
// own code: a Tester with no access to the tool's source drives an isolated workspace like a person and quotes the
// screen. Isolation is a separate tmux server on a short /tmp socket (never the daily Herdr window), a stripped copy
// of the project, and a clean environment (no HC_*/TMUX variables leak in).
// usage: node factory/lab.mjs doctor | run <scenarios.md> [n] [--model haiku] [--keep] | stop [id] | leftovers | --help
//        node factory/lab.mjs drive <id> new|type|keys|read|panes|wait ...   (the Tester's only tool)
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const SELF = fileURLToPath(import.meta.url);
const PROJECT = process.env.LAB_PROJECT ? resolve(process.env.LAB_PROJECT) : resolve(dirname(SELF), '..');
const ROOT = '/tmp/lab'; // short: macOS socket paths must stay under ~100 characters
const REPORTS = join(PROJECT, 'log', 'lab-reports');
// What the lab copy gets: the tools and their settings, never secrets, logs, tasks or the agents' own tests.
const COPY = (process.env.LAB_COPY || 'factory,scripts,tools,hooks,.claude,CLAUDE.md,agents').split(',');
const SKIP = /(^|\/)(\.git|node_modules|log|\.playwright-mcp|reports|expectations\.md|CONTRACT\.md|vars\.json|\.env[^/]*|settings\.local\.json)$/;

const HELP = `lab: black-box checks for tools and agents we build, in an isolated tmux workspace.

  node factory/lab.mjs doctor                         check tmux, claude and a throwaway lab server
  node factory/lab.mjs run <scenarios.md> [n]          run scenario n (or all) with a Tester; report in log/lab-reports/
        --model haiku|sonnet                           Tester model (default sonnet)
        --keep                                         leave the lab running to look at it (then: stop <id>)
  node factory/lab.mjs test <agent> [--model m]       run agents/<agent>/expectations.md against the agent
  node factory/lab.mjs stop [id]                       close a lab (or all) and delete its scratch copy
  node factory/lab.mjs leftovers                       list lab servers and folders still on disk
  node factory/lab.mjs attach <id>                     print the command to watch a lab live

Scenarios file: "## <n> · <title>" then one step per line, e.g.
  ## 1 · The lab itself works
  Open a new pane in the lab workspace.
  Run ls in that pane.
  Read the pane's text back.
  Close the pane.
Examples:
  node factory/lab.mjs run agents/lab-scenarios.md 1
  node factory/lab.mjs run agents/lab-scenarios.md --keep`;

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };

// Every tmux call uses the lab's socket and an environment without the daily workspace's variables.
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HC_|TMUX|HERDR)/.test(k)));
  return { ...env, ...extra };
}
function tmux(id, ...a) {
  const r = spawnSync('tmux', ['-S', sock(id), ...a], { encoding: 'utf8', env: cleanEnv() });
  return { ok: r.status === 0, out: (r.stdout || '').trimEnd(), err: (r.stderr || '').trim() };
}
const dir = (id) => join(ROOT, id);
const sock = (id) => join(ROOT, id, 's');
const log = (id, e) => appendFileSync(join(dir(id), 'screens.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n');

function copyProject(dst) {
  mkdirSync(dst, { recursive: true });
  for (const p of COPY) {
    const src = join(PROJECT, p);
    if (!existsSync(src)) continue;
    cpSync(src, join(dst, p), { recursive: true, filter: (s) => !SKIP.test(relative(PROJECT, s)) && !(statSync(s).isFile() && statSync(s).size > 5e6) });
  }
}

function newLab() {
  const id = 'l' + randomBytes(3).toString('hex');
  const proj = join(dir(id), 'proj');
  copyProject(proj);
  mkdirSync(join(dir(id), 'tester'), { recursive: true });
  const r = tmux(id, 'new-session', '-d', '-s', 'lab', '-x', '160', '-y', '48', '-c', proj);
  if (!r.ok) throw new Error(`tmux server did not start: ${r.err}`);
  tmux(id, 'set-option', '-g', 'remain-on-exit', 'off');
  tmux(id, 'set-environment', '-g', 'LAB_ID', id);
  return id;
}

function stop(id) {
  const left = [];
  tmux(id, 'kill-server');
  if (existsSync(dir(id))) {
    // keep the screens log next to the report, then delete the scratch copy
    const s = join(dir(id), 'screens.jsonl');
    if (existsSync(s)) { mkdirSync(REPORTS, { recursive: true }); cpSync(s, join(REPORTS, `${id}-screens.jsonl`)); }
    rmSync(dir(id), { recursive: true, force: true });
  }
  if (existsSync(dir(id))) left.push(dir(id));
  return left;
}

function leftovers() {
  const runs = existsSync(ROOT) ? readdirSync(ROOT).filter((n) => /^l[0-9a-f]{6}$/.test(n)) : [];
  const live = runs.filter((id) => tmux(id, 'has-session', '-t', 'lab').ok);
  return { runs, live };
}

// ---------- drive: the Tester's only tool ----------
function drive(id, verb, rest) {
  if (!existsSync(sock(id))) return `no lab ${id}`;
  const pane = rest[0] && /^%?\d+$|^lab:/.test(rest[0]) ? rest.shift() : 'lab:';
  switch (verb) {
    case 'panes': { const t = tmux(id, 'list-panes', '-a', '-F', '#{pane_id} #{pane_current_command} #{pane_width}x#{pane_height}').out; log(id, { pane: 'panes', text: t }); return `--- screen of the pane list ---\n${t}\n--- end ---`; }
    case 'new': { const r = tmux(id, 'split-window', '-h', '-P', '-F', '#{pane_id}', '-t', 'lab:', '-c', join(dir(id), 'proj')); return r.ok ? `new pane ${r.out}` : r.err; }
    case 'close': return tmux(id, 'kill-pane', '-t', pane).ok ? `closed ${pane}` : `could not close ${pane}`;
    case 'type': { tmux(id, 'send-keys', '-t', pane, '-l', rest.join(' ')); tmux(id, 'send-keys', '-t', pane, 'Enter'); return `typed into ${pane}`; }
    case 'keys': return tmux(id, 'send-keys', '-t', pane, ...rest).ok ? `pressed ${rest.join(' ')} in ${pane}` : 'keys failed';
    case 'wait': { const s = Math.min(Number(rest[0]) || 5, 60); spawnSync('sleep', [String(s)]); return `waited ${s}s`; }
    case 'read': {
      const r = tmux(id, 'capture-pane', '-p', '-J', '-S', '-200', '-t', pane);
      const text = r.out.split('\n').filter((l, i, a) => l.trim() || (a[i + 1] || '').trim()).join('\n');
      log(id, { pane, text });
      return `--- screen of ${pane} ---\n${text}\n--- end ---`;
    }
    default: return `unknown drive verb ${verb}`;
  }
}

// ---------- run: one Tester per scenario ----------
function scenarios(file) {
  const text = readFileSync(file, 'utf8');
  return text.split(/^## /m).slice(1).map((b) => {
    const [head, ...lines] = b.split('\n');
    return { n: (head.match(/^(\d+)/) || [])[1], title: head.trim(), steps: lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) };
  });
}

function testerPrompt(id, sc) {
  const d = `node ${SELF} drive ${id}`;
  return `You are the lab Tester. You test a workspace from the outside like a person; you know nothing about how its tools were built and you may not look.
Your only tool is this shell command (nothing else is allowed):
  ${d} panes                 list panes (this list counts as screen text)
  ${d} new                   open a new pane (prints its id, e.g. %3)
  ${d} type [%id] <text>     type text and press Enter
  ${d} keys [%id] <keys...>  press keys (tmux names: Enter Escape Up Down C-c)
  ${d} wait <seconds>        wait (max 60)
  ${d} read [%id]            read the visible screen text of a pane
  ${d} close <%id>           close a pane
Without an id, the first pane is used. Programs like claude take a while: wait and read again before judging.
A first start of claude in a new folder may ask whether to trust it: answer it (Enter on "Yes").

Scenario "${sc.title}":
${sc.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

When done, write ONLY this report (no other text):
STEP <k>: I tried <what you did>, expected <what should happen>, got <what happened>. QUOTE: "<exact text copied from a screen you read, or NONE>"
... one line per step ...
RESULT: PASS or FAIL
Rules: judge only from screens you read with "read". A QUOTE must be copied character for character from the text between "--- screen" and "--- end ---" of a read; tool replies such as "typed into %1" are not screen text, so for an action with nothing to read write QUOTE: NONE. To show a result (a listing, an answer, a closed pane), read the pane and quote what is on it. Never invent output.`;
}

function verifyQuotes(id, report) {
  const screens = existsSync(join(dir(id), 'screens.jsonl')) ? readFileSync(join(dir(id), 'screens.jsonl'), 'utf8') : '';
  const seen = screens.split('\n').filter(Boolean).map((l) => JSON.parse(l).text).join('\n');
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const bad = [];
  for (const m of report.matchAll(/QUOTE: "([^"]*)"/g)) {
    const q = m[1];
    if (q === 'NONE' || !q.trim()) continue;
    if (!norm(seen).includes(norm(q))) bad.push(q);
  }
  return bad;
}

function run(file, which, model, keep) {
  const all = scenarios(file).filter((s) => !which || s.n === which);
  if (!all.length) { console.log(`no scenario ${which ?? ''} in ${file}`); process.exit(2); }
  mkdirSync(REPORTS, { recursive: true });
  let failed = 0;
  for (const sc of all) {
    const id = newLab();
    const started = new Date().toISOString();
    console.log(`lab ${id}: scenario ${sc.title} (watch: tmux -S ${sock(id)} attach)`);
    const r = spawnSync('claude', ['-p', testerPrompt(id, sc), '--model', model, '--allowedTools', `Bash(node ${SELF} drive ${id}:*)`,
      '--disallowedTools', 'Read,Edit,Write,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'],
      { cwd: join(dir(id), 'tester'), encoding: 'utf8', env: cleanEnv({ LAB_ID: id }), timeout: 15 * 60 * 1000 });
    let report = (r.stdout || '').trim() || `RESULT: FAIL (tester produced no report: ${(r.stderr || '').slice(0, 300)})`;
    const bad = verifyQuotes(id, report);
    if (bad.length) report += `\nQUOTE CHECK: FAIL — ${bad.length} quote(s) not on any screen read: ${bad.map((q) => JSON.stringify(q.slice(0, 80))).join('; ')}`;
    const pass = /RESULT:\s*PASS/.test(report) && !bad.length;
    if (!pass) failed++;
    const left = keep ? [] : stop(id);
    const out = join(REPORTS, `${id}.md`);
    writeFileSync(out, `# Lab report ${id}\n\nScenario: ${sc.title} (from ${relative(PROJECT, resolve(file))})\nStarted: ${started}\nTester model: ${model}\nVerdict: ${pass ? 'PASS' : 'FAIL'}\n${keep ? `Kept running: node factory/lab.mjs stop ${id}\n` : `Leftovers after stop: ${left.length ? left.join(', ') : 'none'}\n`}\n## Tester report\n\n${report}\n`);
    console.log(`${pass ? 'PASS' : 'FAIL'} ${sc.title} → ${relative(PROJECT, out)}`);
  }
  process.exit(failed ? 1 : 0);
}

function doctor() {
  const checks = [];
  const has = (c) => spawnSync('sh', ['-c', `command -v ${c}`]).status === 0;
  checks.push(['tmux installed', has('tmux')]);
  checks.push(['claude installed', has('claude')]);
  checks.push(['socket path short', sock('l000000').length < 100]);
  let id = null;
  try { id = newLab(); checks.push(['lab server starts', true]); } catch (e) { checks.push(['lab server starts: ' + e.message, false]); }
  if (id) {
    drive(id, 'type', ['echo', 'lab-doctor-ok']); spawnSync('sleep', ['1']);
    checks.push(['type and read a pane', drive(id, 'read', []).includes('lab-doctor-ok')]);
    checks.push(['lab copy has no secrets or tests', !existsSync(join(dir(id), 'proj', 'log')) && !readdirSync(join(dir(id), 'proj')).includes('tasks')]);
    checks.push(['daily Herdr untouched (no HC_ vars in lab)', !tmux(id, 'show-environment', '-g').out.includes('HC_TERMINAL_ID=')]);
    const left = stop(id);
    checks.push(['stop leaves nothing', !left.length && !existsSync(sock(id))]);
  }
  for (const [n, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`);
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

// test <agent>: turn agents/<agent>/expectations.md into one scenario. The Tester gets the expectations; the lab copy
// never has them, and the Tester never sees agent.md.
function testAgent(agent, model, keep) {
  const f = join(PROJECT, existsSync(join(PROJECT,'agents',agent)) ? 'agents' : 'factory/agents', agent, 'expectations.md');
  if (!existsSync(f)) { console.log(`no agents/${agent}/expectations.md`); process.exit(2); }
  const blocks = readFileSync(f, 'utf8').split(/^## /m).slice(1).map((b) => { const [h, ...l] = b.split('\n'); return { h: h.trim(), lines: l.map((x) => x.trim()).filter(Boolean) }; });
  const steps = [
    'In the first pane (this is Main), start claude and answer the trust question if it appears.',
  ];
  for (const b of blocks) {
    for (const l of b.lines) {
      const doM = l.match(/^Do \(Main\):\s*(.+)$/);
      if (doM) steps.push(`[${b.h}] Type into Main exactly: ${doM[1]} — then wait until Main has answered (read it).`);
      else if (/^(Expect|Never)/.test(l)) steps.push(`[${b.h}] Wait about 30 seconds, read the ${agent} pane and judge: ${l}`);
    }
    if (b.h === 'Before') steps.push(`In a new pane, run: factory/agent.sh ${agent} --tmux — then close that new pane only if the ${agent} opened in another one (check the pane list) and read the ${agent} pane: it should say it is watching Main.`);
  }
  const tmp = join(ROOT, `scenario-${agent}.md`);
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(tmp, `## 1 · ${agent} meets its expectations\n${steps.join('\n')}\n`);
  run(tmp, '1', model, keep);
}

const cmd = args.shift();
if (!cmd || cmd === '--help' || cmd === '-h') { console.log(HELP); process.exit(cmd ? 0 : 0); }
if (cmd === 'doctor') doctor();
else if (cmd === 'run') { const model = flag('--model') || 'sonnet'; const keep = bool('--keep'); run(args[0], args[1], model, keep); }
else if (cmd === 'test') { const model = flag('--model') || 'sonnet'; const keep = bool('--keep'); testAgent(args[0], model, keep); }
else if (cmd === 'stop') { const ids = args[0] ? [args[0]] : leftovers().runs; for (const id of ids) { const l = stop(id); console.log(`stopped ${id}${l.length ? ' (left: ' + l.join(', ') + ')' : ''}`); } }
else if (cmd === 'leftovers') console.log(JSON.stringify(leftovers()));
else if (cmd === 'attach') console.log(`tmux -S ${sock(args[0])} attach`);
else if (cmd === 'drive') console.log(drive(args[0], args[1], args.slice(2)));
else { console.log(`unknown command ${cmd}\n\n${HELP}`); process.exit(2); }
