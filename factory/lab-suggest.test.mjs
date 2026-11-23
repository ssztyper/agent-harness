// Checks of factory/lab-suggest.mjs in a throwaway project, no model call (a recorded answer is replayed):
// pointers are checked by code, existing agents are not suggested again, and nothing but one report is written.
//   node scripts/lab-suggest.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('lab-suggest.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'suggest-'));
const files = (d) => readdirSync(d, { recursive: true }).sort();
let n = 0;
const t = (name, f) => { f(); n++; console.log(`ok ${n} ${name}`); };
try {
  mkdirSync(join(root, 'log'), { recursive: true }); mkdirSync(join(root, 'agents', 'payout'), { recursive: true });
  writeFileSync(join(root, 'KEEP.md'), '# Keep\n- a key was pasted into chat\n- a key was pasted into chat again\n');
  writeFileSync(join(root, 'log', 'decisions.jsonl'), '{"q":"key missing"}\n{"q":"key missing"}\n');
  writeFileSync(join(root, 'agents', 'payout', 'agent.md'), '---\nowns:\n  - x\n---\n');
  writeFileSync(join(root, 'answer.json'), JSON.stringify({ suggestions: [
    { name: 'key-keeper', job: 'Puts keys in place before a run.', friction: 'keys pasted and missing', evidence: ['KEEP.md:2', 'log/decisions.jsonl:2', 'KEEP.md:99'] },
    { name: 'made-up', job: 'x', friction: 'y', evidence: ['nowhere.md:1', 'KEEP.md:0'] },
    { name: 'payout', job: 'x', friction: 'y', evidence: ['KEEP.md:2'] }] }));
  const before = files(root);
  const r = spawnSync('node', [SCRIPT, '--answer', join(root, 'answer.json'), '--from', 'KEEP.md,log/*.jsonl'], { encoding: 'utf8', env: { ...process.env, LAB_PROJECT: root } });
  const report = readFileSync(join(root, 'log', 'lab-reports', readdirSync(join(root, 'log', 'lab-reports'))[0]), 'utf8');
  t('a suggestion keeps only pointers that are real lines it was shown, quoted by code', () => {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(report, /## 1\. key-keeper/);
    assert.match(report, /`KEEP\.md:2`: - a key was pasted into chat/);
    assert.match(report, /`log\/decisions\.jsonl:2`/);
    assert.doesNotMatch(report, /KEEP\.md:99/);
  });
  t('a suggestion with no real pointer, or an agent that exists, is dropped and named', () => {
    assert.doesNotMatch(report, /## \d\. (made-up|payout)/);
    assert.match(report, /Dropped: made-up \(no pointer.*payout \(already exists/);
  });
  t('it builds nothing: the only new file is the report', () => {
    const added = files(root).filter((f) => !before.includes(f));
    assert.deepEqual(added.filter((f) => !f.startsWith('log/lab-reports')), []);
    assert.match(report, /Nothing was built/);
  });
  console.log(`lab-suggest test: ${n}/${n} pass`);
} finally { rmSync(root, { recursive: true, force: true }); }
