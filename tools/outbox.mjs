#!/usr/bin/env node
// Keyed side effects: a tiny outbox. An irreversible effect in a batch (send a mail, post a comment, charge)
// carries a key; the outbox runs it at most once per key and journals the outcome, so re-running a crashed
// batch skips what already happened instead of doing it twice.
// The journal is append-only JSONL: {"key","at","state":"started|done|failed", ...}. A key that started
// but never finished means the outcome is unknown (the run died mid-effect): it is refused, not retried,
// because a human must check whether the effect happened. A failed key (exit != 0) may be retried.
// module: import { once } from './outbox.mjs'; const r = await once('log/outbox.jsonl', 'mail-42', () => send());
// cli:    node tools/outbox.mjs <journal.jsonl> <key> -- <command> [args...]
//         runs the command once per key and prints its stdout; a repeat prints nothing to stdout, notes
//         the skip on stderr and exits 0. Exit 5 when the key's outcome is unknown, 2 on bad input.
// One runner per journal at a time.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export class UnknownOutcome extends Error {}

export function lastEntry(journal, key) {
  if (!existsSync(journal)) return undefined;
  let last;
  for (const line of readFileSync(journal, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; } // a torn last line from a crash is not an entry
    if (e.key === key) last = e;
  }
  return last;
}

const append = (journal, entry) => {
  mkdirSync(dirname(journal), { recursive: true });
  appendFileSync(journal, JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n');
};

// Returns { replayed, result }. fn's result must be JSON-serialisable; it is stored with the key.
export async function once(journal, key, fn) {
  const last = lastEntry(journal, key);
  if (last?.state === 'done') return { replayed: true, result: last.result };
  if (last?.state === 'started') {
    throw new UnknownOutcome(`outbox: ${key} started at ${last.at} and never finished; check by hand whether it happened, then append {"key":"${key}","state":"done"} or {"key":"${key}","state":"failed"}`);
  }
  append(journal, { key, state: 'started' });
  try {
    const result = await fn();
    append(journal, { key, state: 'done', result });
    return { replayed: false, result };
  } catch (e) {
    append(journal, { key, state: 'failed', error: String(e.message ?? e).slice(0, 300) });
    throw e;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const sep = args.indexOf('--');
  const [journal, key] = args;
  const command = sep >= 0 ? args.slice(sep + 1) : [];
  if (sep !== 2 || !journal || !key || !command.length) {
    console.error('usage: node tools/outbox.mjs <journal.jsonl> <key> -- <command> [args...]');
    process.exit(2);
  }
  try {
    const { replayed } = await once(journal, key, () => {
      const r = spawnSync(command[0], command.slice(1), { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
      if (r.error) throw r.error;
      process.stdout.write(r.stdout);
      if (r.status !== 0) throw new Error(`exit ${r.status}`);
      return { exit: 0, stdout: r.stdout.slice(0, 2000) };
    });
    if (replayed) console.error(`outbox: ${key} already done; skipped`);
  } catch (e) {
    console.error(e.message);
    process.exit(e instanceof UnknownOutcome ? 5 : 1);
  }
}
