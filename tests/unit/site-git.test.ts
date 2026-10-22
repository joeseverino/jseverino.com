// repoState reads a real checkout: the state site status and site manage show.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { git, gitAsync } from '../../bin/lib/git.ts';
import { repoState } from '../../bin/site/git.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const scratch = scratchDirs('site-git-');
after(scratch.cleanup);

const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

function checkout(): string {
  const root = scratch.make();
  git(root, 'init', '--quiet', '--initial-branch=main');
  return root;
}

describe('gitAsync', () => {
  test('resolves to trimmed stdout', async () => {
    const root = checkout();
    assert.equal(await gitAsync(root, 'rev-parse', '--show-toplevel'), root);
  });

  test('rejects with git\'s own stderr', async () => {
    await assert.rejects(gitAsync(checkout(), 'rev-parse', '--verify', 'no-such-ref'), /Needed a single revision/);
  });
});

describe('repoState', () => {
  test('an empty checkout: the branch is known, every other probe is null', async () => {
    assert.deepEqual(await repoState(checkout()), { branch: 'main', changes: 0, ahead: null, behind: null, commit: null });
  });

  test('counts changes, reads the last commit, and leaves ahead/behind null without origin', async () => {
    const root = checkout();
    write(path.join(root, 'a.txt'), 'a\n');
    git(root, 'add', 'a.txt');
    git(root, ...IDENTITY, 'commit', '--quiet', '-m', 'first');
    write(path.join(root, 'a.txt'), 'changed\n');
    write(path.join(root, 'b.txt'), 'new\n');
    const state = await repoState(root);
    assert.equal(state.branch, 'main');
    assert.equal(state.changes, 2);
    assert.equal(state.ahead, null);
    assert.equal(state.behind, null);
    assert.equal(state.commit?.subject, 'first');
  });

  test('a detached HEAD has no branch', async () => {
    const root = checkout();
    git(root, ...IDENTITY, 'commit', '--quiet', '--allow-empty', '-m', 'first');
    git(root, 'switch', '--quiet', '--detach');
    assert.equal((await repoState(root)).branch, null);
  });
});
