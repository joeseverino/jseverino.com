import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchors, missingPaths, pathRefs, repoIndex, repoPath } from '../audits/check-docs.ts';
import { siteRoot } from '../../src/lib/site-root.ts';

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
  assert.deepEqual(pathRefs(markdown, top), [{ line: 1, path: 'bin/site.ts' }, { line: 1, path: 'docs/Site-CLI.md' }]);
});

test('a path resolves when tracked, under a tracked directory, or ignored', () => {
  const index = {
    tracked: new Set(['bin', 'bin/site.ts', 'docs', 'docs/SEO.md']),
    ignored: (paths: readonly string[]) => new Set(paths.filter((p) => p.startsWith('dist'))),
  };
  const refs = ['bin/site.ts', 'bin/', 'dist/index.html', 'bin/site.mjs', 'src/lib/content'].map((p) => ({ line: 1, path: p }));
  assert.deepEqual(missingPaths(refs, index).map((ref) => ref.path), ['bin/site.mjs', 'src/lib/content']);
});

test('the repo index sees tracked files and ignored generated output', () => {
  const index = repoIndex(siteRoot);
  assert.ok(index.tracked.has('tests/audits/check-docs.ts'));
  assert.ok(index.tracked.has('tests/audits'));
  assert.deepEqual([...index.ignored(['dist/index.html', 'bin/site.ts'])], ['dist/index.html']);
  assert.ok(index.topLevel.has('bin') && index.topLevel.has('node_modules'));
});

test('anchors follow GitHub heading slugs, skip fences, and count explicit ids', () => {
  const markdown = [
    '# Validation Architecture (Full Reference)',
    '## 4. `tests/playwright/`: browser specs',
    '### `check-html.ts`',
    '## Notes',
    '## Notes',
    '```sh',
    '## not a heading',
    '```',
    '<a id="custom"></a>',
  ].join('\n');
  assert.deepEqual([...anchors(markdown)].sort(), [
    '4-testsplaywright-browser-specs', 'check-htmlts', 'custom', 'notes', 'notes-1', 'validation-architecture-full-reference',
  ]);
});
