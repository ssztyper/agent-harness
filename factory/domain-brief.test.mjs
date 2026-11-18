// Checks of the Domain Agents path hook that need no model: agent.md parsing, glob matching, paths from tool calls,
// and which agent owns which file of a throwaway repo.   node factory/domain-brief.test.mjs
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globToRegExp, owners, parseAgent, pathsOf } from './domain-brief.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const repo = realpathSync(mkdtempSync(join(tmpdir(), 'domain-')));
cpSync(join(HERE, '..', 'templates', 'domain-agent'), join(repo, 'agents', 'billing'), { recursive: true });
for (const f of ['src/billing/charge.js', 'src/search/index.js']) { mkdirSync(dirname(join(repo, f)), { recursive: true }); writeFileSync(join(repo, f), ''); }
let n = 0;
const t = (name, f) => { f(); n++; console.log(`ok ${n} ${name}`); };
try {
  t('parseAgent reads owns, model and Job', () => {
    const a = parseAgent('---\nowns:\n  - src/a/**\n  - "test/a/*.js"\nmodel: haiku\naccess: read-only\n---\n# A\n\n## Job\nAdvise.\n\n## Notes\nx\n');
    assert.deepEqual(a.owns, ['src/a/**', 'test/a/*.js']);
    assert.equal(a.model, 'haiku');
    assert.equal(a.job, 'Advise.');
  });
  t('globs: ** spans folders, * stays in one', () => {
    assert.ok(globToRegExp('src/**').test('src/a/b.js'));
    assert.ok(globToRegExp('src/**/x.js').test('src/x.js'));
    assert.ok(globToRegExp('test/*.js').test('test/a.js'));
    assert.ok(!globToRegExp('test/*.js').test('test/a/b.js'));
    assert.ok(!globToRegExp('src/**').test('srcx/a.js'));
  });
  t('paths from file tools and from Bash words', () => {
    assert.deepEqual(pathsOf('Read', { file_path: 'a/b.js' }, '/r'), ['/r/a/b.js']);
    assert.deepEqual(pathsOf('Bash', { command: "sed -n 1,9p 'src/x.js' | head" }, '/r'), ['/r/src/x.js']);
    assert.deepEqual(pathsOf('Bash', { command: 'curl https://a.b/c' }, '/r'), []);
    assert.deepEqual(pathsOf('Grep', { pattern: 'x' }, '/r'), []);
  });
  t('the template agent owns its area, not other code or its own folder', () => {
    assert.deepEqual(owners(join(repo, 'src/billing/charge.js')).map((o) => o.name), ['billing']);
    assert.deepEqual(owners(join(repo, 'src/search/index.js')), []);
    assert.deepEqual(owners(join(repo, 'agents/billing/memories.md')), []);
  });
  console.log(`domain-brief test: ${n}/${n} pass`);
} finally {
  rmSync(repo, { recursive: true, force: true });
}
