#!/usr/bin/env node
// Shows a `claude -p --output-format stream-json --verbose` run as short lines (text, tool calls) for a tmux pane, with
// tokens and keys masked, and keeps the raw stream in a file. `--result <file>` prints the run's final answer.
//   claude -p ... --output-format stream-json --verbose | node schedules/stream-view.mjs <raw.jsonl>
//   node schedules/stream-view.mjs --result <raw.jsonl>
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const mask = (s) => String(s).replace(/v1\.eyJ[A-Za-z0-9._-]+/g, '[token]').replace(/(pk_practice_|sk-[a-z]*-?)[A-Za-z0-9_-]{8,}/g, '$1[…]')
  .replace(/(token=)[A-Za-z0-9_-]{8,}/g, '$1[…]');
const one = (s, n) => mask(s).replace(/\s+/g, ' ').trim().slice(0, n);

if (process.argv[2] === '--result') {
  let result = '';
  for (const l of readFileSync(process.argv[3], 'utf8').split('\n')) {
    try { const e = JSON.parse(l); if (e.type === 'result') result = e.result ?? ''; } catch {}
  }
  process.stdout.write(result);
} else {
  const raw = process.argv[2];
  for await (const line of createInterface({ input: process.stdin })) {
    if (raw) appendFileSync(raw, line + '\n');
    let e; try { e = JSON.parse(line); } catch { console.log(one(line, 200)); continue; }
    const t = new Date().toTimeString().slice(0, 8);
    if (e.type === 'assistant') for (const p of e.message?.content ?? []) {
      if (p.type === 'text' && p.text.trim()) console.log(`${t} ▸ ${one(p.text, 400)}`);
      if (p.type === 'tool_use') console.log(`${t}   ${p.name}: ${one(JSON.stringify(p.input), 160)}`);
    }
    if (e.type === 'result') console.log(`${t} ■ ${e.subtype ?? 'done'} · turns ${e.num_turns} · ${e.total_cost_usd ?? '?'} USD`);
  }
}
