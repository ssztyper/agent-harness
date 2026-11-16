#!/usr/bin/env node
// Decision records check: every record in a folder has the shape an agent can rely on, and every
// "superseded by N" points at a record that exists. Agents read these records before building
// (an accepted one binds), so a record with no Consequences or a dangling link misleads them quietly.
// usage: node tools/records-check.mjs <records dir>
// A record is NNNN-title.md with: "# N. Title", "Status: proposed | accepted | superseded by M",
// "Date: YYYY-MM-DD", and non-empty "## Context", "## Decision", "## Consequences" sections.
// Prints one line per problem; exit 0 when all records are valid, 1 when not, 2 on bad input.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/records-check.mjs <records dir>'); process.exit(2); }
let files;
try { files = readdirSync(dir).filter((f) => /^\d+-.+\.md$/.test(f)).sort(); } catch (e) { console.error(e.message); process.exit(2); }
if (!files.length) { console.error(`${dir}: no NNNN-title.md records`); process.exit(2); }

const numbers = new Set(files.map((f) => parseInt(f, 10)));
const problems = [];
for (const f of files) {
  const text = readFileSync(join(dir, f), 'utf8');
  const n = parseInt(f, 10);
  const say = (msg) => problems.push(`${f}: ${msg}`);
  const title = text.match(/^# (\d+)\. \S.*$/m);
  if (!title) say('no "# N. Title" line');
  else if (Number(title[1]) !== n) say(`title number ${title[1]} does not match the file number ${n}`);
  const status = text.match(/^Status: (.+)$/m)?.[1].trim();
  const sup = status?.match(/^superseded by (\d+)$/);
  if (!status || !(['proposed', 'accepted'].includes(status) || sup)) say(`Status is ${JSON.stringify(status ?? null)}, expected proposed | accepted | superseded by N`);
  if (sup && !numbers.has(Number(sup[1]))) say(`superseded by ${sup[1]}, but no record ${sup[1]} exists`);
  if (sup && Number(sup[1]) === n) say('superseded by itself');
  if (!/^Date: \d{4}-\d{2}-\d{2}$/m.test(text)) say('no "Date: YYYY-MM-DD" line');
  for (const section of ['Context', 'Decision', 'Consequences']) {
    const body = text.split(new RegExp(`^## ${section}\\s*$`, 'm'))[1];
    if (body === undefined) say(`missing section "## ${section}"`);
    else if (!body.split(/^## /m)[0].trim()) say(`section "## ${section}" is empty`);
  }
}
for (const p of problems) console.log(p);
console.log(`${files.length - new Set(problems.map((p) => p.split(':')[0])).size}/${files.length} records valid in ${dir}`);
process.exit(problems.length ? 1 : 0);
