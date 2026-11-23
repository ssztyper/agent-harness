// Checks of factory/sealed.mjs and factory/two-keys.mjs in throwaway folders, no model calls:
// both keys or nothing, an edit after the checks breaks both keys, restore, count-only output, a loud "did NOT run",
// the commit hook, and the OS wall (macOS sandbox-exec or bwrap; skipped where neither exists).
//   node scripts/sealed.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const SEALED = join(here, 'sealed.mjs'), KEYS = join(here, 'two-keys.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'sealed-test-'));
const sealed = join(tmp, 'sealed');
const fakeDecide = join(tmp, 'decide'); writeFileSync(fakeDecide, '#!/bin/sh\necho Approve\n'); chmodSync(fakeDecide, 0o755);
const env = { ...process.env, SEALED_DIR: sealed, DECIDE: fakeDecide };
const node = (script, args, extra = {}) => { const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...env, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] }); return { code: r.status, out: r.stdout + r.stderr }; };
const write = (f, s) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, s); };
let n = 0;
const t = async (name, f) => { await f(); n++; console.log(`ok ${n} ${name}`); };

try {
  process.env.SEALED_DIR = sealed;
  const keys = await import('./two-keys.mjs');
  const live = join(tmp, 'live'), cand = join(tmp, 'cand');
  write(join(live, 'glossary.md'), 'hold: keeps the price\n');
  write(join(cand, 'glossary.md'), 'hold: keeps the price for 24 hours\n');

  await t('a sealed folder inside the project is refused', () => {
    const r = node(KEYS, ['status', cand], { SEALED_DIR: join(here, '..', 'sealed') });
    assert.equal(r.code, 2); assert.match(r.out, /inside the project/);
  });
  await t('the fingerprint is stable and one word changes it', () => {
    const a = keys.fingerprint(cand);
    assert.equal(keys.fingerprint(cand), a);
    write(join(cand, 'glossary.md'), 'hold: keeps the price for 24 hours.\n');
    assert.notEqual(keys.fingerprint(cand), a);
  });
  await t('keep is refused with no recorded checks, and with checks but no person', () => {
    assert.match(node(KEYS, ['keep', cand, '--live', live]).out, /no clean check result/);
    keys.recordResult({ fp: keys.fingerprint(cand), everyday: { passed: 2, total: 2 }, sealed: { passed: 3, total: 3 } });
    const r = node(KEYS, ['keep', cand, '--live', live]);
    assert.equal(r.code, 1); assert.match(r.out, /no person approved/);
  });
  await t('approve without a terminal is refused; on the phone it is recorded with who gave it', () => {
    assert.equal(node(KEYS, ['approve', cand, '--by', 'Owner']).code, 4);
    assert.equal(node(KEYS, ['approve', cand]).code, 2, 'an approval must name who gave it');
    const r = node(KEYS, ['approve', cand, '--by', 'Owner', '--phone']);
    assert.equal(r.code, 0, r.out);
    assert.match(readFileSync(join(sealed, 'keys', 'approvals.jsonl'), 'utf8'), /"by":"Owner","how":"phone"/);
  });
  await t('an approved version with a failing sealed result is refused', () => {
    const bad = join(tmp, 'bad'); write(join(bad, 'glossary.md'), 'hold: expires\n');
    keys.recordResult({ fp: keys.fingerprint(bad), everyday: { passed: 2, total: 2 }, sealed: { passed: 2, total: 3 } });
    write(join(sealed, 'keys', 'approvals.jsonl'), readFileSync(join(sealed, 'keys', 'approvals.jsonl'), 'utf8') + JSON.stringify({ fp: keys.fingerprint(bad), by: 'Owner' }) + '\n');
    assert.match(node(KEYS, ['keep', bad, '--live', live]).out, /no clean check result.*sealed 2\/3/);
  });
  await t('both keys keep it and save the old version; restore puts it back', () => {
    const before = readFileSync(join(live, 'glossary.md'), 'utf8');
    const r = node(KEYS, ['keep', cand, '--live', live]);
    assert.equal(r.code, 0, r.out);
    assert.equal(readFileSync(join(live, 'glossary.md'), 'utf8'), readFileSync(join(cand, 'glossary.md'), 'utf8'));
    assert.equal(node(KEYS, ['restore', '--live', live]).code, 0);
    assert.equal(readFileSync(join(live, 'glossary.md'), 'utf8'), before);
  });
  await t('an edit after the checks ran fits neither key', () => {
    write(join(cand, 'glossary.md'), 'hold: keeps the price for 24 hours. Edited after the run.\n');
    const r = node(KEYS, ['status', cand]);
    assert.equal(r.code, 1); assert.match(r.out, /key 1, checks: no/); assert.match(r.out, /key 2, person: no/);
  });
  await t('sealed eval prints only case numbers and counts, records the subject, keeps details in the sealed folder', () => {
    write(join(sealed, 'harness', 'demo.jsonl'), [
      JSON.stringify({ id: 'QUESTION-ONE-TEXT', cmd: 'echo ok', expect: { contains: ['ok'] } }),
      JSON.stringify({ id: 'QUESTION-TWO-TEXT', cmd: 'echo SECRET-ANSWER', expect: { contains: ['nope'] } })].join('\n') + '\n');
    const r = node(SEALED, ['eval', 'demo', '--runs', '2', '--subject', live]);
    assert.equal(r.code, 1);
    assert.match(r.out, /✓ demo · sealed case 1 · 2 of 2 passed/);
    assert.match(r.out, /✗ demo · sealed case 2 · 0 of 2 passed/);
    assert.doesNotMatch(r.out, /QUESTION|SECRET|echo/);
    assert.match(readFileSync(join(sealed, 'keys', 'results.jsonl'), 'utf8'), new RegExp(`"fp":"${keys.fingerprint(live)}".*"kind":"eval"`));
  });
  await t('a missing sealed folder says out loud that nothing ran (exit 3), never a pass', () => {
    const r = node(SEALED, ['eval', 'demo'], { SEALED_DIR: join(tmp, 'gone') });
    assert.equal(r.code, 3); assert.match(r.out, /sealed cases did NOT run.*not a pass/);
  });
  await t('the commit hook: nothing to run for other files; a touched agent with no sealed cases is reported as not run', () => {
    const repo = join(tmp, 'repo');
    const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
    mkdirSync(repo); git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    write(join(repo, 'agents', 'pay', 'agent.md'), '---\nowns:\n  - src/pay/**\n---\n## Job\nAnswer about payouts.\n');
    write(join(repo, 'README.md'), 'x\n'); git('add', '.'); git('commit', '-qm', 'one');
    assert.equal(node(SEALED, ['install-hook', '--repo', repo]).code, 0);
    write(join(repo, 'README.md'), 'y\n'); git('commit', '-qam', 'two');
    assert.match(readFileSync(join(repo, '.git', 'sealed-last.txt'), 'utf8'), /Nothing to run\./);
    write(join(repo, 'src', 'pay', 'a.js'), '1\n'); git('add', '.');
    const c = spawnSync('git', ['-C', repo, 'commit', '-qm', 'three'], { encoding: 'utf8', env: { ...env, SEALED_DIR: join(tmp, 'gone'), SEALED_RUNS: '1' } });
    assert.equal(c.status, 0, 'the hook never blocks or undoes a commit');
    assert.match(readFileSync(join(repo, '.git', 'sealed-last.txt'), 'utf8'), /pay: the sealed cases did NOT run/);
  });
  await t('the OS wall: read, list, copy and write refused inside, the read works outside', () => {
    const r = node(SEALED, ['off', '--check']);
    if (r.code === 3) { console.log('   (skipped: this machine cannot enforce the wall)'); return; }
    assert.equal(r.code, 0, r.out); assert.match(r.out, /the wall holds/);
  });
  console.log(`sealed test: ${n}/${n} pass`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
