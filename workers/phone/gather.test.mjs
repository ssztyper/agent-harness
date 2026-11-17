#!/usr/bin/env node
// Offline check of workers/phone/gather.mjs against factory/agents/gatherer/expectations.md, over this project as the fixture.
// usage: node workers/phone/gather.test.mjs      prints one PASS/FAIL line per check, exit 0 only when all pass.
// No model, no network: a stub `gh` on PATH records any call (a code-only task must make none), and delegate.sh runs
// with a stub `agent-deck` and MOSHI=true, so nothing is launched or sent.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'gather-test-'));
const ghMark = join(tmp, 'gh-called'), msgFile = join(tmp, 'message.txt');
writeFileSync(join(tmp, 'gh'), `#!/bin/sh\necho "$@" >> '${ghMark}'\nexit 1\n`);
writeFileSync(join(tmp, 'agent-deck'), `#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = --message ] && printf '%s' "$2" > '${msgFile}'; shift; done\n`);
for (const f of ['gh', 'agent-deck']) chmodSync(join(tmp, f), 0o755);
const env = { ...process.env, PATH: `${tmp}:${process.env.PATH}`, MOSHI: 'true', GATHER_PLANNER: 'rules' };
const run = (argv) => execFileSync(process.execPath, [join(ROOT, 'workers/phone/gather.mjs'), ...argv], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });

let failed = 0;
const check = (name, ok, why = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !why ? '' : ' — ' + why}`); if (!ok) failed++; };
const SOURCE = /· source: \S|\(no source: assumption\)/;
const body = (brief) => brief.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
function missingFiles(brief) {
  const bad = [];
  for (const l of body(brief)) {
    const src = (l.split('· source: ')[1] || '').trim();
    const m = src.match(/^([~\w.\/-]+\.[\w]+)(?::(\d+))?(?: \(file mtime\))?$/);
    if (!m) continue;  // a command, a commit, a url or an assumption
    const file = m[1].startsWith('~/') ? join(homedir(), m[1].slice(2)) : join(ROOT, m[1]);
    if (!existsSync(file)) { bad.push(src); continue; }
    if (m[2] && +m[2] > readFileSync(file, 'utf8').split('\n').length) bad.push(src);
  }
  return bad;
}

// 1 · Cites a source on every line (fixture task over this repo)
const brief = run(['add a --quiet flag to workers/phone/job.sh']);
const lines = brief.trimEnd().split('\n');
const unsourced = body(brief).filter((l) => !SOURCE.test(l));
check('every brief line carries a source marker', unsourced.length === 0, unsourced.slice(0, 3).join(' | '));
check('brief stays within 120 lines', lines.length <= 120, `${lines.length} lines`);
check('brief reads the target file', brief.includes('source: workers/phone/job.sh:2'));
check('brief quotes no secret-shaped text', !brief.includes('[secret hidden]'));

// 2 · Skips gatherers the task does not need
check('code-only task did not call gh', !existsSync(ghMark), existsSync(ghMark) ? readFileSync(ghMark, 'utf8').trim() : '');
check('code-only task names the skipped GitHub gatherer', /planner skipped github: .+ · source:/.test(brief));
const plan = JSON.parse(run(['find where moshi-hook is called', '--plan']));
check('search-only task runs only the code gatherer', JSON.stringify(plan.run) === '["code"]', JSON.stringify(plan.run));
const ghPlan = JSON.parse(run(['fix octo/example#3 install path', '--plan']));
check('task naming a repo and issue plans the GitHub gatherer', ghPlan.run.includes('github'), JSON.stringify(ghPlan.run));

// 3 · Never invents a file
const bad = missingFiles(brief);
check('every cited file:line exists', bad.length === 0, bad.slice(0, 3).join(' | '));
const ghost = run(['add a --quiet flag to workers/phone/job.sh and workers/phone/no-such-file.sh']);
check('a named file that is missing is reported, not cited', ghost.includes('workers/phone/no-such-file.sh, which does not exist') && missingFiles(ghost).length === 0);

// delegate.sh puts the brief, rules.md and the plan-first step in front of the task (stubbed launcher)
execFileSync('bash', [join(ROOT, 'workers/phone/delegate.sh'), 'gather-test', 'add a --quiet flag to workers/phone/job.sh'], { cwd: ROOT, env, encoding: 'utf8' });
const msg = existsSync(msgFile) ? readFileSync(msgFile, 'utf8') : '';
check('delegate.sh prepends the brief, rules.md and plan-first via decide.sh',
  msg.indexOf('## Code and tests') >= 0 && msg.indexOf('## Code and tests') < msg.indexOf('Your task:') && msg.includes('workers/phone/rules.md') && /First step: .*plan[\s\S]*decide\.sh[\s\S]*Change no files/.test(msg));
rmSync(msgFile, { force: true });
execFileSync('bash', [join(ROOT, 'workers/phone/delegate.sh'), '--no-gather', 'gather-test', 'add a --quiet flag to workers/phone/job.sh'], { cwd: ROOT, env, encoding: 'utf8' });
const plain = existsSync(msgFile) ? readFileSync(msgFile, 'utf8') : '';
check('delegate.sh --no-gather sends the task without a brief', plain.startsWith('Your task:') && !plain.includes('## Code and tests'));

rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `gather test: ${failed} failed` : 'gather test: all passed');
process.exit(failed ? 1 : 0);
