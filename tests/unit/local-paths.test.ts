import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import {
  lifeVaultRoot,
  resumeEngineRoot,
  vaultMcpRoot,
  vaultRoot,
} from '../../bin/lib/local-paths.ts';

test('vault root: explicit override, then NOTES_HOME, then the default layout', () => {
  assert.equal(vaultRoot({ VAULT_DIR: '/v', NOTES_HOME: '/n' }), '/v');
  assert.equal(vaultRoot({ NOTES_HOME: '/n' }), '/n');
  assert.equal(vaultRoot({}), path.join(os.homedir(), 'Documents', 'Code', 'Severino Labs'));
});

test('life vault and sibling repos: override, then the home-absolute default', () => {
  const cases = [
    [lifeVaultRoot, 'LIFE_VAULT_DIR', ['Documents', 'Life']],
    [resumeEngineRoot, 'RESUME_ENGINE_DIR', ['Code', 'Assets', 'resume-engine']],
    [vaultMcpRoot, 'VAULT_MCP_DIR', ['Code', 'Assets', 'severino-vault-mcp']],
  ] as const;
  for (const [resolve, variable, segments] of cases) {
    assert.equal(resolve({ [variable]: '/x/../override' }), '/override', variable);
    assert.equal(resolve({}), path.join(os.homedir(), ...segments), variable);
  }
});
