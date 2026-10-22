import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fromRoot } from '../../src/lib/site-root.ts';

// The content root is fixed when the module loads, so each reading runs in its own process.
function snapshotIn(contentRoot: string): { writeups: string[]; pages: string[] } {
  const module = pathToFileURL(fromRoot('src/lib/snapshot.ts')).href;
  const script = `const m = await import(${JSON.stringify(module)}); console.log(JSON.stringify({ writeups: m.snapshotWriteups().map((w) => w.slug), pages: m.snapshotPageSlugs() }));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: fromRoot('tests'),
    env: { ...process.env, SITE_CONTENT_ROOT: contentRoot },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const documents = (dir: string): string[] =>
  fs.readdirSync(fromRoot(dir)).filter((name) => fs.existsSync(fromRoot(dir, name, 'index.mdx'))).sort();

test('the snapshot reads the content root the build reads, from any working directory', () => {
  assert.deepEqual(snapshotIn('tests/fixtures/content'), {
    writeups: documents('tests/fixtures/content/writeups'),
    pages: documents('tests/fixtures/content/pages'),
  });
});
