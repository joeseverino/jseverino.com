import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { git, gitAsync } from '../../bin/lib/git.ts';
import { scratchDirs } from './helpers/fs.ts';

const scratch = scratchDirs('git-');
after(scratch.cleanup);

function checkout(): string {
  const root = scratch.make();
  git(root, 'init', '--quiet');
  return root;
}

test('gitAsync resolves to trimmed stdout', async () => {
  const root = checkout();
  assert.equal(await gitAsync(root, 'rev-parse', '--show-toplevel'), root);
});

test("gitAsync rejects with git's own stderr", async () => {
  await assert.rejects(gitAsync(checkout(), 'rev-parse', '--verify', 'no-such-ref'), /Needed a single revision/);
});
