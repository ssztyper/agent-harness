#!/usr/bin/env node
// Events and hooks. One inbox, log/events.jsonl, one shape per event:
// { source, type, id, hash, at, payload, kind }. kind is decided by identity AND content: the first arrival of an id is
// `new`, the same id with the same content is a `repeat` (never a second piece of work), the same id with new content is
// a `change` (a conflict for a person, never applied on its own): deduplicating by id alone drops a corrected event.
// Jobs register hooks in jobs/<job>/hooks.json: { id, trigger: {source?, type?, kind?}, condition?: {path, op, value},
// response: {kind: approval|alert|run, ...}, note, until? }; plain code matches every event against them, each hook fires
// once per event, every firing goes to jobs/<job>/history.jsonl, and `job-end` removes the hooks.
//   node factory/events.mjs emit <source> <type> <id> [payload-json]      (prints the event's kind)
//   node factory/events.mjs watch <source> --job "<cmd>" [--once]         (new events run the job; bookmark moves after it)
//   node factory/events.mjs hook <job> '<hook-json>'   |   node factory/events.mjs job-end <job>
//   node factory/events.mjs list [source]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.EVENTS_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INBOX = join(ROOT, 'log', 'events.jsonl');
const MARKS = join(ROOT, 'log', 'events-bookmarks.json');
const JOBS = join(ROOT, 'jobs');
const DECIDE = process.env.DECIDE || join(ROOT, 'workers', 'phone', 'decide.sh');
const MOSHI = process.env.MOSHI || 'moshi-hook';

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/** Key order does not change the hash: {"a":1,"b":2} and {"b":2,"a":1} are the same content. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const hashOf = (type, payload) => createHash('sha256').update(`${type}\n${canonical(payload)}`).digest('hex').slice(0, 16);

/** new | repeat | change, from the earlier events of the same source and id. */
export function kindOf(earlier, ev) {
  const same = earlier.filter((e) => e.source === ev.source && e.id === ev.id);
  if (!same.length) return 'new';
  return same.some((e) => e.hash === ev.hash) && same.at(-1).hash === ev.hash ? 'repeat' : 'change';
}

export function emit(source, type, id, payload = {}) {
  const ev = { source, type, id: String(id), hash: hashOf(type, payload), at: new Date().toISOString(), payload };
  ev.kind = kindOf(lines(INBOX), ev);
  mkdirSync(dirname(INBOX), { recursive: true });
  appendFileSync(INBOX, JSON.stringify(ev) + '\n');
  return ev;
}

// ---------- hooks ----------
const get = (obj, path) => String(path ?? '').split('.').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), obj);
function holds(cond, ev) {
  if (!cond) return true;
  const v = get(ev, cond.path);
  switch (cond.op) {
    case '>': return Number(v) > Number(cond.value);
    case '<': return Number(v) < Number(cond.value);
    case '!=': return v !== cond.value;
    case 'has': return String(v ?? '').toLowerCase().includes(String(cond.value).toLowerCase());
    default: return v === cond.value;
  }
}
export const matches = (h, ev) => Object.entries(h.trigger ?? {}).every(([k, want]) => ev[k] === want) && holds(h.condition, ev)
  && !(h.until && h.until !== 'job-end' && Date.parse(h.until) < Date.parse(ev.at));

function respond(job, h, ev) {
  const r = h.response ?? {};
  const env = { ...process.env, EVENT_JSON: JSON.stringify(ev), HOOK_NOTE: h.note ?? '', JOB: job };
  const text = `${job}: ${h.note ?? h.id} (${ev.source} ${ev.type} ${ev.id}, ${ev.kind})`;
  if (r.kind === 'approval') {
    const args = ['--timeout', r.timeout ?? '60m', '--source', 'events', ...(r.url ? ['--url', r.url] : []), ...(r.check ? ['--check', r.check] : []), text, ...(r.options ?? ['Approve', 'Skip'])];
    const p = spawnSync(DECIDE, args, { encoding: 'utf8', env });
    return { status: p.status, choice: (p.stdout || '').trim() };
  }
  if (r.kind === 'alert') {
    const p = spawnSync(MOSHI, ['notify', '--source', 'events', '--title', `Alert: ${job}`, text], { encoding: 'utf8', env });
    return { status: p.status };
  }
  if (r.kind === 'run') {
    const p = spawnSync('bash', ['-c', r.cmd], { encoding: 'utf8', env, cwd: ROOT });
    return { status: p.status, out: (p.stdout || '').trim().slice(-300) };
  }
  return { status: 2, error: `unknown response ${r.kind}` };
}

/** Every registered hook that matches the event fires once; the firing is recorded in the job's history. */
export function fireHooks(ev) {
  if (!existsSync(JOBS)) return [];
  const fired = [];
  for (const job of readdirSync(JOBS)) {
    const hooks = readJson(join(JOBS, job, 'hooks.json'), []);
    const histFile = join(JOBS, job, 'history.jsonl');
    const seen = new Set(lines(histFile).map((x) => `${x.hook}|${x.event}`));
    for (const h of hooks) {
      const key = `${h.id}|${ev.source}:${ev.id}:${ev.hash}`;
      if (!matches(h, ev) || seen.has(key)) continue;
      const result = respond(job, h, ev);
      appendFileSync(histFile, JSON.stringify({ at: new Date().toISOString(), hook: h.id, event: `${ev.source}:${ev.id}:${ev.hash}`, kind: ev.kind, result }) + '\n');
      fired.push({ job, hook: h.id, result });
    }
  }
  return fired;
}

export function addHook(job, hook) {
  if (!hook.id || !hook.response?.kind) throw new Error('a hook needs an id and a response.kind');
  const f = join(JOBS, job, 'hooks.json');
  mkdirSync(dirname(f), { recursive: true });
  const hooks = readJson(f, []).filter((h) => h.id !== hook.id);
  writeFileSync(f, JSON.stringify([...hooks, { owner: job, ...hook }], null, 1));
}
export const endJob = (job) => rmSync(join(JOBS, job, 'hooks.json'), { force: true });

// ---------- watch: new events run the job; the bookmark moves only after the job finished ----------
export function watchOnce(source, jobCmd) {
  const marks = readJson(MARKS, {});
  const all = lines(INBOX);
  let at = marks[source] ?? 0;
  const out = [];
  for (; at < all.length; at++) {
    const ev = all[at];
    if (ev.source !== source) continue;
    const fired = fireHooks(ev);
    if (ev.kind === 'new' && jobCmd) {
      const p = spawnSync('bash', ['-c', jobCmd], { encoding: 'utf8', cwd: ROOT, env: { ...process.env, EVENT_JSON: JSON.stringify(ev) } });
      if (p.status !== 0) { out.push({ id: ev.id, kind: ev.kind, job: 'failed', status: p.status }); break; } // bookmark stays: retried next time
      out.push({ id: ev.id, kind: ev.kind, job: 'done', fired: fired.length });
    } else out.push({ id: ev.id, kind: ev.kind, job: ev.kind === 'new' ? 'none' : 'skipped', fired: fired.length });
    marks[source] = at + 1;
    mkdirSync(dirname(MARKS), { recursive: true });
    writeFileSync(MARKS, JSON.stringify(marks));
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...a] = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const flag = (n) => { const i = a.indexOf(n); return i >= 0 ? (a.splice(i, 1), true) : false; };
  if (cmd === 'emit') {
    const [source, type, id, payload] = a;
    if (!source || !type || id === undefined) { console.log('usage: events.mjs emit <source> <type> <id> [payload-json]'); process.exit(2); }
    const ev = emit(source, type, id, payload ? JSON.parse(payload) : {});
    console.log(ev.kind);
  } else if (cmd === 'watch') {
    const job = opt('--job'); const once = flag('--once'); const [source] = a;
    if (!source) { console.log('usage: events.mjs watch <source> --job "<cmd>" [--once]'); process.exit(2); }
    for (;;) {
      for (const r of watchOnce(source, job)) console.log(JSON.stringify(r));
      if (once) break;
      spawnSync('sleep', [process.env.EVENTS_POLL || '5']);
    }
  } else if (cmd === 'hook') { addHook(a[0], JSON.parse(a[1])); console.log(`hook added to jobs/${a[0]}/hooks.json`); }
  else if (cmd === 'job-end') { endJob(a[0]); console.log(`hooks of ${a[0]} removed`); }
  else if (cmd === 'list') { for (const e of lines(INBOX).filter((e) => !a[0] || e.source === a[0])) console.log(`${e.at} ${e.source} ${e.type} ${e.id} ${e.kind}`); }
  else { console.log('usage: events.mjs emit|watch|hook|job-end|list (see the header of this file)'); process.exit(2); }
}
