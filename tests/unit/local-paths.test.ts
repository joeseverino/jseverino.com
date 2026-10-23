import { test } from 'node:test';
import assert from 'node:assert/strict';

import { educationExportFile, existingDir, lifeVaultRoot, resumeEngineRoot, vaultRoot } from '../../bin/lib/local-paths.ts';

test('vault root: VAULT_DIR, then NOTES_HOME', () => {
  assert.equal(vaultRoot({ VAULT_DIR: '/v', NOTES_HOME: '/n' }), '/v');
  assert.equal(vaultRoot({ NOTES_HOME: '/n' }), '/n');
});

test('every machine path comes from its variable, with no default', () => {
  const cases = [
    [vaultRoot, 'VAULT_DIR'],
    [lifeVaultRoot, 'LIFE_VAULT_DIR'],
    [resumeEngineRoot, 'RESUME_ENGINE_DIR'],
  ] as const;
  for (const [resolve, variable] of cases) {
    assert.equal(resolve({ [variable]: '/x/../override' }), '/override', variable);
    assert.throws(() => resolve({}), new RegExp(`^Error: [\\w -]+ not configured: set ${variable} in mise\\.local\\.toml \\[env\\]$`), variable);
  }
});

test('education export: an explicit file, otherwise none', () => {
  assert.equal(educationExportFile({ EDUCATION_EXPORT_FILE: '/d.json' }), '/d.json');
  assert.equal(educationExportFile({}), undefined);
});

test('a missing directory is one line', () => {
  assert.throws(() => existingDir('vault', '/nowhere/vault', 'VAULT_DIR'), /^Error: vault not found: \/nowhere\/vault \(set VAULT_DIR\)$/);
});
