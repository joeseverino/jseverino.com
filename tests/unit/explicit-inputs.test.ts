import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { trackedFiles } from '../../bin/lib/git.ts';
import { educationExportFile, existingDir, lifeVaultRoot, resumeEngineRoot, vaultRoot } from '../../bin/lib/local-paths.ts';
import { fromRoot } from './helpers/desired-state.ts';

let root: string;
let home: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'explicit-inputs-'));
  home = path.join(root, 'home');
  fs.mkdirSync(home);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

// The sync CLI with only the environment given: no PATH tools, no shell profile, an empty home.
const sync = (env: Record<string, string>) =>
  spawnSync(process.execPath, [fromRoot('bin/sync-content.ts'), '--check', '--json'], { cwd: fromRoot('.'), encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: home, ...env } });

describe('the sync CLI on a machine with nothing of the author\'s', () => {
  test('checks the vault it is pointed at', () => {
    const vault = path.join(root, 'vault');
    fs.mkdirSync(path.join(vault, '05 Writeups'), { recursive: true });
    fs.mkdirSync(path.join(vault, '06 Pages'));
    const run = sync({ VAULT_DIR: vault });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), { ok: true, documents: [] });
  });

  test('without one, stops on a single line that names the path and the variable', () => {
    const run = sync({});
    assert.equal(run.status, 2);
    assert.equal(run.stderr.trim().split('\n').length, 1);
    assert.match(run.stderr, new RegExp(`vault not found: ${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*\\(set VAULT_DIR\\)`));
  });
});

describe('where each input comes from', () => {
  test('an override wins, and the default sits under the home directory', () => {
    const env = { VAULT_DIR: '/a', LIFE_VAULT_DIR: '/b', RESUME_ENGINE_DIR: '/c', EDUCATION_EXPORT_FILE: '/d.json' };
    assert.deepEqual([vaultRoot(env), lifeVaultRoot(env), resumeEngineRoot(env), educationExportFile(env)], ['/a', '/b', '/c', '/d.json']);
    for (const dir of [vaultRoot({}), lifeVaultRoot({}), resumeEngineRoot({})]) assert.ok(dir.startsWith(os.homedir()), dir);
    assert.equal(educationExportFile({}), undefined);
  });

  test('a missing directory is one line', () => {
    assert.throws(() => existingDir('vault', '/nowhere/vault', 'VAULT_DIR'), /^Error: vault not found: \/nowhere\/vault \(set VAULT_DIR\)$/);
  });

  test('only the path defaults and the local audit log read the home directory', () => {
    const readers = trackedFiles(fromRoot('.'), 'bin', 'src', 'functions')
      .filter((file) => file.endsWith('.ts') && fs.readFileSync(fromRoot(file), 'utf8').includes('homedir('));
    assert.deepEqual(readers.sort(), ['bin/lib/local-paths.ts', 'bin/lib/site-ops.ts']);
  });
});
