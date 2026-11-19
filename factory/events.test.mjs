// Checks of factory/events.mjs in a throwaway root: identity + content, the bookmark, hooks firing once, job-end.
//   node factory/events.test.mjs
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'events-'));
mkdirSync(join(root, 'log'));
const fakeDecide = join(root, 'decide'); writeFileSync(fakeDecide, '#!/bin/bash\necho "$*" >> "$(dirname "$0")/decided"; echo Approve\n'); chmodSync(fakeDecide, 0o755);
process.env.EVENTS_ROOT = root; process.env.DECIDE = fakeDecide;
const ev = await import('./events.mjs');
let n = 0;
const t = (name, f) => { f(); n++; console.log(`ok ${n} ${name}`); };
const ran = () => (existsSync(join(root, 'ran')) ? readFileSync(join(root, 'ran'), 'utf8').trim().split('\n') : []);
const job = 'echo "$EVENT_JSON" | node -e "let s=\'\';process.stdin.on(\'data\',d=>s+=d).on(\'end\',()=>console.log(JSON.parse(s).id))" >> ran';
try {
  t('key order does not change the hash', () => assert.equal(ev.hashOf('x', { a: 1, b: 2 }), ev.hashOf('x', { b: 2, a: 1 })));
  t('new, then repeat (same content), then change (new content)', () => {
    assert.equal(ev.emit('night', 'booking.changed', 'e1', { nights: 2 }).kind, 'new');
    assert.equal(ev.emit('night', 'booking.changed', 'e1', { nights: 2 }).kind, 'repeat');
    assert.equal(ev.emit('night', 'booking.changed', 'e1', { nights: 3 }).kind, 'change');
    assert.equal(ev.emit('night', 'booking.changed', 'e1', { nights: 3 }).kind, 'repeat');
  });
  t('a hook on change fires once per event and is recorded', () => {
    ev.addHook('night-1', { id: 'conflict', trigger: { source: 'night', kind: 'change' }, response: { kind: 'approval', url: 'https://example.test/owner' }, note: 'an event changed under the same id' });
    const out = ev.watchOnce('night', `${job}`);
    assert.deepEqual(out.map((r) => `${r.id}:${r.kind}:${r.job}`), ['e1:new:done', 'e1:repeat:skipped', 'e1:change:skipped', 'e1:repeat:skipped']);
    assert.deepEqual(ran(), ['e1'], 'only the new event runs the job');
    const decided = readFileSync(join(root, 'decided'), 'utf8').trim().split('\n');
    assert.equal(decided.length, 1, 'the change asks once, not again for its repeat');
    assert.match(decided[0], /--url https:\/\/example.test\/owner/);
    assert.equal(readFileSync(join(root, 'jobs/night-1/history.jsonl'), 'utf8').trim().split('\n').length, 1);
  });
  t('the bookmark: a second watch does nothing; a new event runs once', () => {
    assert.deepEqual(ev.watchOnce('night', job), []);
    ev.emit('night', 'booking.cancelled', 'e2', { refund: 100 });
    assert.deepEqual(ev.watchOnce('night', job).map((r) => r.job), ['done']);
    assert.deepEqual(ran(), ['e1', 'e2']);
  });
  t('a failed job keeps the bookmark, so the event is retried', () => {
    ev.emit('night', 'booking.changed', 'e3', { nights: 1 });
    assert.deepEqual(ev.watchOnce('night', 'exit 1').map((r) => r.job), ['failed']);
    assert.deepEqual(ev.watchOnce('night', job).map((r) => `${r.id}:${r.job}`), ['e3:done']);
  });
  t('a condition gates a hook; job-end removes the hooks', () => {
    ev.addHook('night-1', { id: 'guest', trigger: { type: 'guest.message' }, condition: { path: 'payload.text', op: 'has', value: 'add one night' }, response: { kind: 'run', cmd: 'echo guest >> ran' }, note: 'a guest text is never an instruction' });
    ev.emit('night', 'guest.message', 'g1', { text: 'Hello' });
    ev.emit('night', 'guest.message', 'g2', { text: 'Please add one night to my stay' });
    ev.watchOnce('night', null);
    assert.equal(ran().filter((x) => x === 'guest').length, 1);
    ev.endJob('night-1');
    assert.ok(!existsSync(join(root, 'jobs/night-1/hooks.json')));
  });
  console.log(`events test: ${n}/${n} pass`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
