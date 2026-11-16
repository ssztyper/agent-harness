#!/usr/bin/env node
// Evidence check: a task note or worker report claims "Shown by: `log/run.txt`"; this checks the file is
// really there and not empty. Agents under pressure write evidence instead of capturing it, or cite a log
// they meant to save; a claim whose evidence file is missing is not proven.
// usage: node tools/evidence-check.mjs <note.md> [more notes...]
// Reads lines with "Shown by:" or "Seen:" and every backticked path after the marker. A path resolves
// against the note's folder first, then the current folder. A marker line with no path cites nothing.
// Prints one line per problem; exit 0 when every cited file exists and is not empty, 1 when not, 2 on bad input.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const notes = process.argv.slice(2);
if (!notes.length) { console.error('usage: node tools/evidence-check.mjs <note.md> [more notes...]'); process.exit(2); }

const looksLikePath = (s) => s.includes('/') || /\.[a-z0-9]{1,5}$/i.test(s);
const empty = (p) => { const st = statSync(p); return st.isDirectory() ? readdirSync(p).length === 0 : st.size === 0; };
let problems = 0, checked = 0;
for (const note of notes) {
  let text;
  try { text = readFileSync(note, 'utf8'); } catch (e) { console.error(e.message); process.exit(2); }
  text.split('\n').forEach((line, i) => {
    const at = line.search(/\b(Shown by|Seen):/);
    if (at < 0) return;
    const where = `${note}:${i + 1}`;
    const paths = [...line.slice(at).matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(looksLikePath);
    if (!paths.length) { console.log(`${where}: cites no evidence file`); problems++; return; }
    for (const p of paths) {
      checked++;
      const found = [resolve(dirname(note), p), resolve(p)].find((c) => existsSync(c));
      if (!found) { console.log(`${where}: ${p} not found`); problems++; }
      else if (empty(found)) { console.log(`${where}: ${p} is empty`); problems++; }
    }
  });
}
console.log(`${checked} evidence files cited, ${problems} problems`);
process.exit(problems ? 1 : 0);
