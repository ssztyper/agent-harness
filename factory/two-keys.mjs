#!/usr/bin/env node
// Two keys. A version of a subject (an agent's folder, a
// skill's folder) is one fingerprint over all its files. A candidate goes live only when BOTH keys name exactly that
// fingerprint: a recorded check result with no everyday and no sealed failure (written by factory/sealed.mjs into the
// sealed folder), and a person's approval (typed in a terminal or given on the phone). Results and approvals live in the
// sealed folder, so an agent started through `sealed.mjs off` can neither write its own pass nor its own approval.
// Before keeping, the live version is saved, so one command puts it back. One word changed after the checks ran is a
// different version, and neither key fits any more.
//   node factory/two-keys.mjs status  <candidate-dir>
//   node factory/two-keys.mjs approve <candidate-dir> --by "<name>" [--phone]
//   node factory/two-keys.mjs keep    <candidate-dir> --live <dir>
//   node factory/two-keys.mjs restore --live <dir> [--list]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = process.env.SEALED_PROJECT ? resolve(process.env.SEALED_PROJECT) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DECIDE = process.env.DECIDE || join(PROJECT, 'workers', 'phone', 'decide.sh');

/** The sealed folder: $SEALED_DIR or ~/.sealed/<project name>; never inside the project (the agent could read it there). */
export function sealedDir() {
  const d = resolve(process.env.SEALED_DIR || join(homedir(), '.sealed', basename(PROJECT)));
  if (d === PROJECT || d.startsWith(PROJECT + sep)) throw new Error(`sealed folder ${d} is inside the project ${PROJECT}; move it outside`);
  return d;
}
const keysDir = () => join(sealedDir(), 'keys');
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

function filesOf(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? filesOf(p, base) : e.isFile() ? [relative(base, p)] : [];
  });
}

/** sha256 over every file's relative path and bytes, sorted; 16 hex characters. */
export function fingerprint(dir) {
  const h = createHash('sha256');
  for (const f of filesOf(dir)) h.update(f).update('\0').update(readFileSync(join(dir, f))).update('\0');
  return h.digest('hex').slice(0, 16);
}

/** Written by sealed.mjs after a run: { fp, subject, everyday: {passed,total}, sealed: {passed,total} }. */
export function recordResult(entry) {
  mkdirSync(keysDir(), { recursive: true });
  appendFileSync(join(keysDir(), 'results.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

const clean = (r) => r && r.sealed?.total > 0 && r.sealed.passed === r.sealed.total && (r.everyday?.passed ?? 0) === (r.everyday?.total ?? 0);

export function keys(fp) {
  const result = lines(join(keysDir(), 'results.jsonl')).filter((r) => r.fp === fp).at(-1) ?? null;
  const approval = lines(join(keysDir(), 'approvals.jsonl')).filter((a) => a.fp === fp).at(-1) ?? null;
  return { fp, result, checks: clean(result), approval, approved: Boolean(approval) };
}

function approve(cand, by, phone) {
  const fp = fingerprint(cand);
  if (!by) return [2, 'approve needs --by "<name>": the approval names who gave it'];
  const k = keys(fp);
  const what = `${basename(cand)} version ${fp.slice(0, 8)} (checks: ${k.result ? `everyday ${k.result.everyday?.passed}/${k.result.everyday?.total}, sealed ${k.result.sealed?.passed}/${k.result.sealed?.total}` : 'none recorded'})`;
  if (phone) {
    const r = spawnSync(DECIDE, ['--source', 'two-keys', `Approve ${what} to go live?`, 'Approve', 'Deny'], { encoding: 'utf8' });
    if (r.status !== 0 || r.stdout.trim() !== 'Approve') return [1, `not approved on the phone (${r.stdout.trim() || `exit ${r.status}`})`];
  } else {
    // A person types the version's first 8 characters; a script or an agent without a terminal cannot.
    if (!process.stdin.isTTY) return [4, 'no terminal: a person approves by typing the version, or use --phone'];
    process.stdout.write(`Approve ${what}? Type ${fp.slice(0, 8)} to approve: `);
    const typed = spawnSync('bash', ['-c', 'read -r x </dev/tty; printf %s "$x"'], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }).stdout.trim();
    if (typed !== fp.slice(0, 8)) return [1, 'not approved: the typed version did not match'];
  }
  mkdirSync(keysDir(), { recursive: true });
  appendFileSync(join(keysDir(), 'approvals.jsonl'), JSON.stringify({ at: new Date().toISOString(), fp, by, how: phone ? 'phone' : 'terminal', subject: basename(cand) }) + '\n');
  return [0, `approved ${fp} by ${by}`];
}

const backupsOf = (live) => join(keysDir(), 'backups', createHash('sha256').update(resolve(live)).digest('hex').slice(0, 12));

function replaceContents(dst, src) {
  for (const e of readdirSync(dst)) rmSync(join(dst, e), { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
}

function keep(cand, live) {
  if (!live || !existsSync(live) || !statSync(live).isDirectory()) return [2, 'keep needs --live <dir> (the folder the candidate replaces)'];
  const fp = fingerprint(cand);
  const k = keys(fp);
  if (!k.checks) return [1, `refused: no clean check result for ${fp} (${k.result ? `everyday ${k.result.everyday?.passed}/${k.result.everyday?.total}, sealed ${k.result.sealed?.passed}/${k.result.sealed?.total}` : 'no run recorded for this exact version'})`];
  if (!k.approved) return [1, `refused: no person approved ${fp}`];
  const old = fingerprint(live);
  const dir = join(backupsOf(live), `${Date.now()}-${old.slice(0, 8)}`);
  mkdirSync(dirname(dir), { recursive: true });
  cpSync(live, dir, { recursive: true });
  replaceContents(live, cand);
  appendFileSync(join(keysDir(), 'history.jsonl'), JSON.stringify({ at: new Date().toISOString(), live: resolve(live), from: old, to: fp, backup: dir, by: k.approval.by }) + '\n');
  return [0, `kept ${fp} in ${live}; old version ${old} saved (restore: two-keys.mjs restore --live ${live})`];
}

function restore(live, list) {
  const dir = backupsOf(live);
  const saved = existsSync(dir) ? readdirSync(dir).sort() : [];
  if (list) return [0, saved.length ? saved.join('\n') : 'no saved versions'];
  if (!saved.length) return [1, `no saved version for ${live}`];
  const pick = join(dir, saved.at(-1));
  const now = fingerprint(live);
  cpSync(live, join(dir, `${Date.now()}-${now.slice(0, 8)}-before-restore`), { recursive: true });
  replaceContents(live, pick);
  rmSync(pick, { recursive: true, force: true });
  appendFileSync(join(keysDir(), 'history.jsonl'), JSON.stringify({ at: new Date().toISOString(), live: resolve(live), from: now, to: fingerprint(live), restored: saved.at(-1) }) + '\n');
  return [0, `restored ${live} to ${fingerprint(live)}`];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const flag = (n) => { const i = a.indexOf(n); return i >= 0 ? (a.splice(i, 1), true) : false; };
  const [cmd] = a.splice(0, 1);
  const live = opt('--live'), by = opt('--by'), phone = flag('--phone'), list = flag('--list');
  const cand = a[0] && resolve(a[0]);
  let out;
  try {
    if (cmd !== 'restore' && (!cand || !existsSync(cand))) out = [2, 'usage: two-keys.mjs status|approve|keep <candidate-dir> [...] | restore --live <dir> (see the header of this file)'];
    else if (cmd === 'status') { const k = keys(fingerprint(cand)); out = [k.checks && k.approved ? 0 : 1, `version ${k.fp}\n  key 1, checks: ${k.checks ? 'yes' : 'no'}${k.result ? ` (everyday ${k.result.everyday?.passed}/${k.result.everyday?.total}, sealed ${k.result.sealed?.passed}/${k.result.sealed?.total}, ${k.result.at})` : ' (no run for this exact version)'}\n  key 2, person: ${k.approved ? `yes (${k.approval.by}, ${k.approval.how}, ${k.approval.at})` : 'no'}`]; }
    else if (cmd === 'approve') out = approve(cand, by, phone);
    else if (cmd === 'keep') out = keep(cand, live && resolve(live));
    else if (cmd === 'restore') out = live ? restore(resolve(live), list) : [2, 'restore needs --live <dir>'];
    else out = [2, 'usage: two-keys.mjs status|approve|keep|restore (see the header of this file)'];
  } catch (e) { out = [2, e.message]; }
  console.log(out[1]);
  process.exitCode = out[0];
}
