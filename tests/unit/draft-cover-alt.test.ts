import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { siteRoot } from '../../src/lib/site-root.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const scratch = scratchDirs('cover-alt-test-');
after(scratch.cleanup);

test('bulk cover-alt generation skips unpublished metadata before reading images or calling the API', () => {
  const vault = scratch.make();
  for (const [slug, published] of [
    ['draft', 'false'],
    ['missing-state', ''],
    ['ambiguous', '"true"'],
  ]) {
    write(path.join(vault, '05 Writeups', slug ?? '', 'index.md'), `---\ntitle: Private\npublished: ${published}\ncover_image: ./missing.png\n---\nBody\n`);
  }
  const stub = path.join(vault, 'deny-fetch.mjs');
  write(stub, 'globalThis.fetch = () => { throw new Error("unexpected external request"); };\n');
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, 'bin/draft-cover-alt.ts', '--all'], {
    cwd: siteRoot,
    encoding: 'utf8',
    env: { ...process.env, VAULT_DIR: vault, ANTHROPIC_API_KEY: 'dummy-test-key' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.match(/not published/g)?.length, 3);
});

test('unusable replies and request failures are reported per slug, never applied, and fail the run', () => {
  const vault = scratch.make();
  for (const slug of ['truncated', 'offline']) {
    write(path.join(vault, '05 Writeups', slug, 'index.md'), `---\ntitle: ${slug}\npublished: true\ncover_image: ./cover.png\n---\nBody\n`);
    write(path.join(vault, '05 Writeups', slug, 'cover.png'), 'not really a png');
  }
  const stub = path.join(vault, 'stub-fetch.mjs');
  write(
    stub,
    [
      'globalThis.fetch = async (_url, init) => {',
      '  if (JSON.parse(init.body).messages[0].content[1].text.includes("Title: offline")) throw new Error("network down");',
      '  return new Response(JSON.stringify({ stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "" }] }));',
      '};',
    ].join('\n'),
  );
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, 'bin/draft-cover-alt.ts', '--all', '--apply'], {
    cwd: siteRoot,
    encoding: 'utf8',
    env: { ...process.env, VAULT_DIR: vault, ANTHROPIC_API_KEY: 'dummy-test-key' },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /truncated: no usable draft \(stop_reason max_tokens\)/);
  assert.match(result.stderr, /offline: Error: network down/);
  assert.doesNotMatch(result.stdout, /applied/);
});
