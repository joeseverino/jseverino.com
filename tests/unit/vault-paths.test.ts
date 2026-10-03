import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import { lifeVaultRoot, vaultRoot } from '../../bin/content-sync/vault-paths.mjs';

test('vault root: explicit override, then NOTES_HOME, then the default layout', () => {
  assert.equal(vaultRoot({ VAULT_DIR: '/v', NOTES_HOME: '/n' }), '/v');
  assert.equal(vaultRoot({ NOTES_HOME: '/n' }), '/n');
  assert.equal(vaultRoot({}), path.join(os.homedir(), 'Documents', 'Code', 'Severino Labs'));
});

test('life vault root: explicit override, then the default layout', () => {
  assert.equal(lifeVaultRoot({ LIFE_VAULT_DIR: '/l' }), '/l');
  assert.equal(lifeVaultRoot({}), path.join(os.homedir(), 'Documents', 'Life'));
});
