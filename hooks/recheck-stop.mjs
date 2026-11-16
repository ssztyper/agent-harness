#!/usr/bin/env node
// Stop hook: before the agent stops, look again at the sources an open task relied on.
// Every open tasks/<id>/CONTRACT.md (Status not "closed") may list lines `recheck: <url>`.
// The hook fetches each url and compares it with the copy it saw last time
// (tasks/<id>/.recheck/<sha of url>). Anything new → block with a reason naming what changed.
//
// Wired in .claude/settings.json → hooks → Stop. Input: JSON on stdin (session_id, stop_hook_active).
// Pass: print nothing, exit 0. Block: print {"decision":"block","reason":"…"}, exit 0.
// Guard: after 3 blocks in one session it lets the agent stop; a source it cannot fetch never blocks.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const MAX_BLOCKS = 3;
const root = resolve(new URL('..', import.meta.url).pathname);
const input = (() => {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
})();
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const roundsFile = join(tmpdir(), `recheck-stop-${sha(String(input.session_id ?? 'none'))}`);
const rounds = existsSync(roundsFile) ? Number(readFileSync(roundsFile, 'utf8')) || 0 : 0;
if (rounds >= MAX_BLOCKS) process.exit(0);

// The names in a JSON listing ({files:[{name}]}) are what matters; for anything else, the whole body.
function digest(body) {
  try {
    const names = JSON.parse(body)?.files?.map((f) => f.name);
    if (Array.isArray(names)) return { key: sha(names.join('\n')), names };
  } catch {}
  return { key: sha(body), names: null };
}

const changes = [];
const tasks = join(root, 'tasks');
for (const code of existsSync(tasks) ? readdirSync(tasks) : []) {
  const contract = join(tasks, code, 'CONTRACT.md');
  if (!existsSync(contract)) continue;
  const text = readFileSync(contract, 'utf8');
  if (/Status:\s*closed/i.test(text)) continue;
  for (const [, url] of text.matchAll(/^recheck:\s*(https?:\/\/\S+)/gim)) {
    let body;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      body = await res.text();
    } catch {
      continue;
    }
    const dir = join(tasks, code, '.recheck');
    const seenFile = join(dir, sha(url) + '.json');
    const now = digest(body);
    const seen = existsSync(seenFile) ? JSON.parse(readFileSync(seenFile, 'utf8')) : null;
    mkdirSync(dir, { recursive: true });
    writeFileSync(seenFile, JSON.stringify({ url: url.slice(0, 80), at: new Date().toISOString(), ...now }, null, 2));
    if (!seen || seen.key === now.key) continue;
    const added = now.names && seen.names ? now.names.filter((n) => !seen.names.includes(n)) : [];
    changes.push(`${code}: a source changed since the last look` + (added.length ? ` — new: ${added.join(', ')}` : ''));
  }
}

if (!changes.length) process.exit(0);
writeFileSync(roundsFile, String(rounds + 1));
console.log(JSON.stringify({
  decision: 'block',
  reason: `Look again before you stop. ${changes.join('; ')}. Read what is new, update the answer if it changes a decision, and log it under Changes in the contract.`,
}));
