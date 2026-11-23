#!/usr/bin/env node
// /lab suggest. Reads the project's own records for the same friction again
// and again and suggests at most a few agents the project does not have yet, each pointing at where it saw the problem.
// It builds nothing: a suggestion becomes an agent only when a person picks it and writes its expectations. Code, not the
// model, checks every pointer: a suggestion whose pointers are not real lines of the records it was shown is dropped.
//   node factory/lab-suggest.mjs [--from "<glob>,<glob>"] [--model sonnet] [--max 3] [--answer <file>]
//   --from    record files (default $LAB_SUGGEST_FROM or the list below); `*` matches inside one path segment
//   --answer  read the model's JSON from a file instead of calling it (replays and tests)
// Writes log/lab-reports/suggest-<date>.md and prints its path.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answer, globToRegExp } from './domain-brief.mjs';

const PROJECT = process.env.LAB_PROJECT ? resolve(process.env.LAB_PROJECT) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FROM = 'KEEP.md,log/*.jsonl,log/lab-reports/*.md,tasks/*/SOLUTION.md';
const TAIL = 120;       // lines per file, newest last
const BUDGET = 60000;   // characters of records per run

/** Files under `root` matching one glob, segment by segment (no walking of whole trees). */
export function expand(root, glob) {
  let found = [''];
  for (const seg of glob.split('/')) {
    const re = globToRegExp(seg);
    found = found.flatMap((p) => {
      const dir = join(root, p);
      if (!seg.includes('*')) return existsSync(join(dir, seg)) ? [p ? `${p}/${seg}` : seg] : [];
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
      return readdirSync(dir).filter((n) => re.test(n)).sort().map((n) => (p ? `${p}/${n}` : n));
    });
  }
  return found.filter((p) => p && statSync(join(root, p)).isFile());
}

/** The last lines of each record file, numbered as `path:line| text`; the shown ranges are what pointers may cite. */
export function excerpts(root, globs) {
  const shown = new Map();
  let text = '', size = 0;
  const files = [...new Set(globs.flatMap((g) => expand(root, g)))]
    .sort((a, b) => statSync(join(root, b)).mtimeMs - statSync(join(root, a)).mtimeMs);
  for (const f of files) {
    const all = readFileSync(join(root, f), 'utf8').split('\n');
    const from = Math.max(0, all.length - TAIL);
    const block = all.slice(from).map((l, i) => `${f}:${from + i + 1}| ${l.slice(0, 300)}`).join('\n');
    if (size + block.length > BUDGET) continue;
    size += block.length; text += `\n=== ${f} ===\n${block}\n`;
    shown.set(f, { from: from + 1, to: all.length, lines: all });
  }
  return { text, shown };
}

/** Keeps a suggestion only when it names a new agent and at least one pointer is a real line it was shown. */
export function validate(list, shown, existing) {
  const kept = [], dropped = [];
  for (const s of (Array.isArray(list) ? list : [])) {
    const name = String(s?.name ?? '').trim();
    const evidence = (s?.evidence ?? []).map((e) => {
      const m = /^(.+):(\d+)$/.exec(String(e).trim());
      const f = m && shown.get(m[1]);
      const n = m && Number(m[2]);
      return f && n >= f.from && n <= f.to ? { ref: `${m[1]}:${n}`, line: f.lines[n - 1].trim().slice(0, 200) } : null;
    }).filter(Boolean);
    if (!name || existing.includes(name.toLowerCase())) dropped.push({ name, why: 'already exists or has no name' });
    else if (!evidence.length) dropped.push({ name, why: 'no pointer is a line of the records it was shown' });
    else kept.push({ name, job: String(s.job ?? ''), friction: String(s.friction ?? ''), evidence });
  }
  return { kept, dropped };
}

function existingAgents(root) {
  const names = [];
  for (const d of ['agents', '.claude/agents', '.claude/skills']) {
    const p = join(root, d);
    if (existsSync(p)) names.push(...readdirSync(p).map((n) => basename(n, '.md').toLowerCase()));
  }
  return names;
}

export function main(argv) {
  const a = [...argv];
  const opt = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a.splice(i, 2)[1] : d; };
  const globs = opt('--from', process.env.LAB_SUGGEST_FROM || FROM).split(',').map((s) => s.trim()).filter(Boolean);
  const model = opt('--model', 'sonnet'), max = Number(opt('--max', '3')), replay = opt('--answer');
  const { text, shown } = excerpts(PROJECT, globs);
  if (!shown.size) { console.log(`no records found for ${globs.join(', ')}`); return 2; }
  const existing = existingAgents(PROJECT);
  let raw;
  if (replay) raw = readFileSync(replay, 'utf8');
  else {
    const r = answer(model, 'You read a project\'s own records and suggest agents it does not have yet. You build nothing and change nothing.',
      `Records (each line is "path:line| text"):\n${text}\n\nAgents and skills the project already has: ${existing.join(', ') || 'none'}.\n\n` +
      `Find friction that shows up again and again (the same kind of mistake, refusal, manual step or question) that none of the existing agents handles. ` +
      `Suggest at most ${max} new agents. Each cites at least two "path:line" pointers copied exactly from the records above. ` +
      'Reply with JSON only: {"suggestions":[{"name":"<kebab-case>","job":"<one sentence>","friction":"<what repeats, one sentence>","evidence":["path:line", ...]}]}', 240000);
    if (!r.ok) { console.log(`the model gave no answer: ${r.error}`); return 1; }
    raw = r.text;
  }
  let list = [];
  try { list = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).suggestions; } catch {}
  const { kept, dropped } = validate(list, shown, existing);
  const day = new Date().toISOString().slice(0, 10);
  const out = join(PROJECT, 'log', 'lab-reports', `suggest-${day}.md`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `# Lab suggest · ${day}\n\nRead ${shown.size} record files (${globs.join(', ')}). Nothing was built.\n\n` +
    (kept.slice(0, max).map((s, i) => `## ${i + 1}. ${s.name}\n${s.job}\n\nFriction: ${s.friction}\n\n${s.evidence.map((e) => `- \`${e.ref}\`: ${e.line}`).join('\n')}\n`).join('\n') || 'No suggestion survived the pointer check.\n') +
    (dropped.length ? `\nDropped: ${dropped.map((d) => `${d.name || '(no name)'} (${d.why})`).join('; ')}\n` : '') +
    '\nNext: a person picks one, writes its expectations, and it graduates from the lab. Until then it is only a suggestion.\n');
  console.log(`${kept.length ? kept.slice(0, max).map((s) => `suggest ${s.name}: ${s.evidence.length} pointer(s)`).join('\n') : 'no suggestion survived the pointer check'}\nreport: ${out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
