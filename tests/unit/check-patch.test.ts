import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fromRoot } from '../../src/lib/site-root.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const task = fromRoot('mise-tasks/checks/patch');
const dirs = scratchDirs('check-patch-');
after(dirs.cleanup);

// Each repository here sees no global or system git config, so no hook, signing or identity of
// the machine reaches it. GITHUB_ACTIONS is set only by the cases that stand in for a CI checkout.
const { GITHUB_ACTIONS: _, ...inherited } = process.env;
const env = {
  ...inherited,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Example',
  GIT_AUTHOR_EMAIL: 'example@example.com',
  GIT_COMMITTER_NAME: 'Example',
  GIT_COMMITTER_EMAIL: 'example@example.com',
};

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, env, encoding: 'utf8' });

function commit(cwd: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) write(path.join(cwd, file), content);
  git(cwd, 'add', '--all');
  git(cwd, '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '--quiet', '--message', 'change');
}

// An origin whose main already carries a line with trailing whitespace, which no branch changed.
function origin(): string {
  const dir = dirs.make();
  git(dir, 'init', '--quiet', '--initial-branch=main');
  commit(dir, { 'old.txt': 'kept as it was \n' });
  return dir;
}

function clone(source: string, ...args: string[]): string {
  const dir = path.join(dirs.make(), 'clone');
  git(path.dirname(dir), 'clone', '--quiet', ...args, source, dir);
  return dir;
}

function run(cwd: string, extra: Record<string, string> = {}) {
  return spawnSync('sh', [task], { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
}

// Built here, so no tracked file carries a marker the tree-wide search would find.
const marker = (char: string): string => char.repeat(7);

describe('checks:patch on a branch', () => {
  test('passes a clean change, though the base it left already had a whitespace error', () => {
    const repo = clone(origin());
    commit(repo, { 'new.txt': 'clean\n' });
    assert.equal(run(repo).status, 0);
  });

  test('fails a committed line with trailing whitespace', () => {
    const repo = clone(origin());
    commit(repo, { 'new.txt': 'trailing \n' });
    const result = run(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /new\.txt:1: trailing whitespace/);
  });

  test('fails an uncommitted line with trailing whitespace', () => {
    const repo = clone(origin());
    write(path.join(repo, 'old.txt'), 'kept as it was \nedited \n');
    assert.notEqual(run(repo).status, 0);
  });

  test('fails a conflict marker anywhere in the tracked tree, whether or not the branch changed it', () => {
    const source = origin();
    commit(source, { 'merged.md': `${marker('<')} ours\nline\n${marker('>')} theirs\n` });
    const repo = clone(source);
    const result = run(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /merged\.md:1:/);
  });

  test('refuses to pass when it cannot find the base', () => {
    const repo = clone(origin());
    git(repo, 'remote', 'set-head', 'origin', '--delete');
    const result = run(repo);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /set-head origin --auto/);
  });
});

// A CI checkout is one commit deep: the commit under test and nothing behind it.
describe('checks:patch in Actions', () => {
  const ci = { GITHUB_ACTIONS: 'true' };

  test('fetches the first parent and fails a whitespace error the checked-out commit adds', () => {
    const source = origin();
    commit(source, { 'new.txt': 'trailing \n' });
    const repo = clone(`file://${source}`, '--depth=1');
    const result = run(repo, ci);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /new\.txt:1: trailing whitespace/);
  });

  test('passes a clean commit on a parent that already had a whitespace error', () => {
    const source = origin();
    commit(source, { 'new.txt': 'clean\n' });
    const repo = clone(`file://${source}`, '--depth=1');
    assert.equal(run(repo, ci).status, 0);
  });
});
