#!/usr/bin/env node
// Red/green check for a test an agent wrote: it must FAIL on the base code (on an assertion, not on a
// syntax or import error) and PASS on the fixed code. Exit 0 only for red-then-green.
//
// usage: node scripts/redgreen.mjs --base <repo dir> --fix <repo dir> --test <test file>
//          [--as test/<name>.test.ts] [--runner "node_modules/.bin/vitest run"] [--logs <dir>]
//
// The test is copied into each repo under --as (default: test/redgreen-<file name>), run there,
// and removed again. A file already at that path is never overwritten.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
for (const k of ['base', 'fix', 'test']) {
  if (!args[k]) {
    console.error(`missing --${k}\nusage: node scripts/redgreen.mjs --base <dir> --fix <dir> --test <file> [--as test/x.test.ts]`);
    process.exit(2);
  }
}

const test = resolve(args.test);
const as = args.as ?? `test/redgreen-${basename(test)}`;
const runner = (args.runner ?? 'node_modules/.bin/vitest run').split(' ');
const logs = resolve(args.logs ?? 'redgreen-logs');
mkdirSync(logs, { recursive: true });

// Signs that the test never reached an assertion: it proves nothing about the bug.
const NOT_AN_ASSERTION = /SyntaxError|Cannot find module|Failed to load url|Failed to resolve import|Transform failed|No test files found|ReferenceError|is not a function/;
const ASSERTION = /AssertionError|expected .* (to|not)/;

function run(label, dir) {
  const repo = resolve(dir);
  const target = join(repo, as);
  if (existsSync(target)) {
    console.error(`${label}: ${target} already exists; pick another --as`);
    process.exit(2);
  }
  copyFileSync(test, target);
  try {
    const r = spawnSync(runner[0], [...runner.slice(1), as], { cwd: repo, encoding: 'utf8', env: { ...process.env, CI: '1' } });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const log = join(logs, `${label}.log`);
    writeFileSync(log, out);
    return { code: r.status ?? 1, out, log };
  } finally {
    rmSync(target, { force: true });
  }
}

const base = run('base', args.base);
const fix = run('fix', args.fix);

const problems = [];
if (base.code === 0) problems.push('base: the test PASSES on the base code, so it does not catch the bug');
else if (NOT_AN_ASSERTION.test(base.out) || !ASSERTION.test(base.out)) problems.push('base: it fails, but not on an assertion (syntax, import or runtime error)');
if (fix.code !== 0) problems.push('fix: the test FAILS on the fixed code');

const firstAssertion = (base.out.match(/AssertionError[^\n]*/) ?? [''])[0];
console.log(`test   ${as}`);
console.log(`base   exit ${base.code}  ${firstAssertion}  (${base.log})`);
console.log(`fix    exit ${fix.code}  (${fix.log})`);
if (problems.length) {
  console.log(`NOT red/green:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('red/green: fails on the base on an assertion, passes with the fix');
