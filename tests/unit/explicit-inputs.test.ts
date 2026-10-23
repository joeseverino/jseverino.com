import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, beforeEach, describe, test } from 'node:test';
import { trackedFiles } from '../../bin/lib/git.ts';
import { fromRoot } from '../../src/lib/site-root.ts';
import { scratchDirs } from './helpers/fs.ts';

const scratch = scratchDirs('explicit-inputs-');
let root: string;
let home: string;
beforeEach(() => {
  root = scratch.make();
  home = path.join(root, 'home');
  fs.mkdirSync(home);
});
after(scratch.cleanup);

// The sync CLI with only the environment given: no PATH tools, no shell profile, an empty home.
const sync = (env: Record<string, string>) =>
  spawnSync(process.execPath, [fromRoot('bin/sync-content.ts'), '--check', '--json'], {
    cwd: fromRoot('.'),
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: home, ...env },
  });

describe("the sync CLI on a machine with nothing of the author's", () => {
  test('checks the vault it is pointed at', () => {
    const vault = path.join(root, 'vault');
    fs.mkdirSync(path.join(vault, '05 Writeups'), { recursive: true });
    fs.mkdirSync(path.join(vault, '06 Pages'));
    const run = sync({ VAULT_DIR: vault });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), { ok: true, documents: [] });
  });

  // Each way to lack a vault stops on one line that says what to do about it.
  const stopsOnOneLine = (env: Record<string, string>, message: RegExp) => {
    const run = sync(env);
    assert.equal(run.status, 2);
    assert.equal(run.stderr.trim().split('\n').length, 1);
    assert.match(run.stderr, message);
  };

  test('without one, stops on a line that names the variable and where to set it', () => {
    stopsOnOneLine({}, /vault not configured: set VAULT_DIR in mise\.local\.toml \[env\]/);
  });

  test('pointed at a missing vault, stops on a line that names the path and the variable', () => {
    const missing = path.join(root, 'missing');
    stopsOnOneLine({ VAULT_DIR: missing }, new RegExp(`vault not found: ${RegExp.escape(missing)}.*\\(set VAULT_DIR\\)`));
  });
});

describe('where each input comes from', () => {
  test('only the local audit log reads the home directory', () => {
    const readers = trackedFiles(fromRoot('.'), 'bin', 'src').filter(
      (file) => file.endsWith('.ts') && fs.readFileSync(fromRoot(file), 'utf8').includes('homedir('),
    );
    assert.deepEqual(readers.sort(), ['bin/lib/site-ops.ts']);
  });
});
