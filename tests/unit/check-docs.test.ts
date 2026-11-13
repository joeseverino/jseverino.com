import assert from 'node:assert/strict';
import { test } from 'node:test';
import { siteRoot } from '../../src/lib/site-root.ts';
import { fileName, fileNameRefs, miseTaskRuns, missingNames, missingPaths, npmScriptRuns, pathRefs, repoIndex, repoPath } from '../audits/check-docs.ts';

const top = new Set(['bin', 'docs', 'src', 'tests', 'dist', '.cache']);

test('a backticked token names a repo path only under a top-level entry', () => {
  assert.equal(repoPath('bin/site.ts', top), 'bin/site.ts');
  assert.equal(repoPath('bin/site.ts:42', top), 'bin/site.ts');
  assert.equal(repoPath('docs/SEO.md#canonical', top), 'docs/SEO.md');
  assert.equal(repoPath('SITE_CONTENT_ROOT=.cache/drafts', top), '.cache/drafts');
  assert.equal(repoPath('tests/audits/<name>.ts', top), 'tests/audits/');
  assert.equal(repoPath('src/styles/**/*.css', top), 'src/styles/');
  for (const token of ['index.md', 'bin', '/portfolio/slug/', './images/x.png', 'astro/logger/json', '--json', '<slug>/index.md']) {
    assert.equal(repoPath(token, top), null, token);
  }
});

test('paths come from inline code outside fences, every token of a command', () => {
  const markdown = [
    'Run `node bin/site.ts --help` or read `docs/Site-CLI.md`.',
    '```sh',
    'node bin/inside-a-fence.ts',
    '```',
    'Plain bin/not-code.ts is prose.',
  ].join('\n');
  assert.deepEqual(pathRefs(markdown, top), [
    { line: 1, path: 'bin/site.ts' },
    { line: 1, path: 'docs/Site-CLI.md' },
  ]);
});

test('a path resolves when tracked, under a tracked directory, or ignored', () => {
  const index = {
    tracked: new Set(['bin', 'bin/site.ts', 'docs', 'docs/SEO.md']),
    ignored: (paths: readonly string[]) => new Set(paths.filter((p) => p.startsWith('dist'))),
  };
  const refs = ['bin/site.ts', 'bin/', 'dist/index.html', 'bin/site.mjs', 'src/lib/content'].map((p) => ({ line: 1, path: p }));
  assert.deepEqual(
    missingPaths(refs, index).map((ref) => ref.path),
    ['bin/site.mjs', 'src/lib/content'],
  );
});

test('a bare token names a file by a source extension, never a host, a property or an image', () => {
  assert.equal(fileName('contact.openapi.json'), 'contact.openapi.json');
  assert.equal(fileName('guard.ts:12'), 'guard.ts');
  assert.equal(fileName('SITE_CACHE_DIR=mise.toml'), 'mise.toml');
  for (const token of ['jseverino.com', 'SITE.domain', 'engines.node', 'favicon.svg', 'robots.txt', '.env', 'tokens.json', 'mise.local.toml']) {
    assert.equal(fileName(token), null, token);
  }
});

test('a bare file name resolves only to a tracked file of that name', () => {
  const markdown = 'Bound to `contact-openapi.json`, built by `build-csp.ts`.\n```sh\ncat stale.ts\n```';
  const refs = fileNameRefs(markdown);
  assert.deepEqual(refs, [
    { line: 1, path: 'contact-openapi.json' },
    { line: 1, path: 'build-csp.ts' },
  ]);
  const names = new Set(['contact.openapi.json', 'build-csp.ts']);
  assert.deepEqual(missingNames(refs, { names }).map((ref) => ref.path), ['contact-openapi.json']);
});

test('the repo index sees tracked files and ignored generated output', () => {
  const index = repoIndex(siteRoot);
  assert.ok(index.tracked.has('tests/audits/check-docs.ts'));
  assert.ok(index.tracked.has('tests/audits'));
  assert.ok(index.names.has('check-docs.ts'));
  assert.deepEqual([...index.ignored(['dist/index.html', 'bin/site.ts'])], ['dist/index.html']);
  assert.ok(index.topLevel.has('bin') && index.topLevel.has('node_modules'));
});

test('a task name stops before the punctuation after it, and a placeholder is no task', () => {
  assert.deepEqual(miseTaskRuns('then `mise run fast`, or mise run fast.'), ['fast', 'fast']);
  assert.deepEqual(miseTaskRuns('mise run fast: checks:*'), ['fast']);
  assert.deepEqual(miseTaskRuns("mise run -c 'checks:*' and mise run -j 2 built:weight"), ['checks:*', 'built:weight']);
  assert.deepEqual(miseTaskRuns('A["mise run browser:e2e"] --> B'), ['browser:e2e']);
  assert.deepEqual(miseTaskRuns('mise run sync:<name> or mise run <task>'), []);
});

test('a doc line that runs any npm script is caught, the build included', () => {
  assert.deepEqual(npmScriptRuns('run `npm run build -- --timings`, then `npm run -s lint`'), ['build', 'lint']);
  assert.deepEqual(npmScriptRuns('`npm ci` installs; `mise run build` builds'), []);
});
