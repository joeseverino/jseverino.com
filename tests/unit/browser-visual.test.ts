import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fromRoot } from '../../src/lib/site-root.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const dirs = scratchDirs('browser-visual-');
after(dirs.cleanup);

// The task under a stand-in uname naming the platform, and a stand-in playwright that prints
// its arguments; neither calls the real program.
function run(platform: string, ...args: string[]) {
  const bin = dirs.make();
  for (const [name, body] of Object.entries({ uname: `echo ${platform}`, playwright: 'echo "playwright $*"' })) {
    write(path.join(bin, name), `#!/bin/sh\n${body}\n`);
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  return spawnSync('sh', [fromRoot('mise-tasks/browser/visual'), ...args], {
    cwd: fromRoot(),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
}

test('off macOS the visual suite says it skipped and fails, so no aggregate counts it as passed', () => {
  const result = run('Linux');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /skipped on Linux/);
  assert.doesNotMatch(result.stdout, /playwright/);
});

test('on macOS it runs the visual config with the arguments it was given', () => {
  const result = run('Darwin', '--update-snapshots');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'playwright test -c tests/playwright.visual.config.ts --update-snapshots');
});
