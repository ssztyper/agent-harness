#!/usr/bin/env node
// Eval runner: runs each case's command and scores its output against fixed expectations.
// usage: node tools/eval.mjs <cases.jsonl> [--out report.json] [--baseline old-report.json] [--timeout 120] [--repeat k]
// A case line: {"id":"c1","cmd":"node tool.mjs x","expect":{"exit":0,"contains":["a"],"absent":["secret"],
//               "regex":"^ok","maxBytes":1024,"json":[{"path":"result.status","equals":"accepted"}]}}
// A case that only greps a rule's text carries "kind":"text"; the summary counts behaviour vs text cases,
// because a text case proves a rule is written down, not that anything follows it.
// --repeat k runs each case k times and passes it only when all k pass (pass^k, not pass@1), because one
// lucky run hides a flaky tool; cases that passed some runs and failed others print as FLAKY.
// Prints one line per case, the pass rate and, with --baseline, which cases got fixed or regressed.
// Exit 0 only when every case passes. Reports go next to the cases unless --out says otherwise.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const casesFile = args[0];
if (!casesFile || casesFile.startsWith('--')) {
  console.error('usage: node tools/eval.mjs <cases.jsonl> [--out report.json] [--baseline old.json] [--timeout 120] [--repeat k]');
  process.exit(2);
}
const out = opt('--out', casesFile.replace(/\.jsonl$/, '') + '.report.json');
const baseline = opt('--baseline');
const timeout = Number(opt('--timeout', 120)) * 1000;
const repeat = Number(opt('--repeat', 1));
if (!Number.isInteger(repeat) || repeat < 1) { console.error('--repeat needs a whole number ≥ 1'); process.exit(2); }

// Read the baseline first: by default it is the same file this run writes its report to.
const old = baseline ? Object.fromEntries(JSON.parse(readFileSync(baseline, 'utf8')).results.map((r) => [r.id, r.pass])) : null;
const cases = readFileSync(casesFile, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => JSON.parse(l));
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function run(c) {
  const t0 = Date.now();
  let stdout = '', exit = 0;
  try {
    stdout = execFileSync('/bin/sh', ['-c', c.cmd], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  } catch (e) {
    stdout = e.stdout ?? '';
    exit = e.status ?? (e.signal ? 124 : 1);
  }
  const e = c.expect ?? {};
  const checks = [];
  const check = (name, ok, got) => checks.push({ name, ok, got });
  if ('exit' in e) check(`exit ${e.exit}`, exit === e.exit, exit);
  for (const s of e.contains ?? []) check(`contains ${JSON.stringify(s)}`, stdout.includes(s));
  for (const s of e.absent ?? []) check(`absent ${JSON.stringify(s)}`, !stdout.includes(s));
  if (e.regex) check(`regex /${e.regex}/`, new RegExp(e.regex, 'm').test(stdout));
  const bytes = Buffer.byteLength(stdout);
  if (e.maxBytes != null) check(`≤ ${e.maxBytes} B`, bytes <= e.maxBytes, bytes);
  if (e.json) {
    let parsed;
    try { parsed = JSON.parse(stdout); } catch { parsed = undefined; }
    for (const j of e.json) {
      const v = parsed === undefined ? undefined : get(parsed, j.path);
      check(`json ${j.path} = ${JSON.stringify(j.equals)}`, JSON.stringify(v) === JSON.stringify(j.equals), v);
    }
  }
  return { id: c.id, pass: checks.every((x) => x.ok), checks, exit, bytes, ms: Date.now() - t0 };
}

// With --repeat, a case keeps the first failing run (or the last run) and counts how many runs passed.
function runK(c) {
  const runs = Array.from({ length: repeat }, () => run(c));
  const passes = runs.filter((r) => r.pass).length;
  const shown = runs.find((r) => !r.pass) ?? runs[runs.length - 1];
  const kind = c.kind === 'text' ? 'text' : 'behaviour';
  return { ...shown, kind, pass: passes === repeat, ...(repeat > 1 && { runs: repeat, passes, flaky: passes > 0 && passes < repeat }) };
}

const results = cases.map(runK);
for (const r of results) {
  const failed = r.checks.filter((x) => !x.ok).map((x) => `${x.name}${x.got !== undefined ? ` (got ${JSON.stringify(x.got)})` : ''}`);
  const label = r.pass ? 'PASS' : r.flaky ? 'FLAKY' : 'FAIL';
  const runs = r.runs ? ` · ${r.passes}/${r.runs} runs` : '';
  console.log(`${label} ${r.id}${runs} · ${r.ms} ms · ${r.bytes} B${failed.length ? ' — ' + failed.join('; ') : ''}`);
}
const passed = results.filter((r) => r.pass).length;
const text = results.filter((r) => r.kind === 'text').length;
const flaky = results.filter((r) => r.flaky).map((r) => r.id);
const report = { cases: casesFile, at: new Date().toISOString(), passed, total: results.length, behaviour: results.length - text, text, repeat, flaky, results };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 1));
console.log(`${passed}/${results.length} passed · ${results.length - text} behaviour, ${text} text${repeat > 1 ? ` · pass^${repeat}, flaky [${flaky.join(', ')}]` : ''} · report ${out}`);

if (old) {
  const fixed = results.filter((r) => r.pass && old[r.id] === false).map((r) => r.id);
  const regressed = results.filter((r) => !r.pass && old[r.id] === true).map((r) => r.id);
  console.log(`vs baseline: fixed [${fixed.join(', ')}] · regressed [${regressed.join(', ')}]`);
  if (regressed.length) process.exitCode = 1;
}
if (passed < results.length) process.exitCode = 1;
