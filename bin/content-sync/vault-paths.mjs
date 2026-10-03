// Where the vaults live on the authoring machine. One answer for every script:
// an explicit override first, then the shell's NOTES_HOME, then the default
// layout. The site repo and the vaults are not siblings, so nothing here is
// relative to the repo.
import os from 'node:os';
import path from 'node:path';

export function vaultRoot(env = process.env) {
  return path.resolve(env.VAULT_DIR || env.NOTES_HOME || path.join(os.homedir(), 'Documents', 'Code', 'Severino Labs'));
}

export function lifeVaultRoot(env = process.env) {
  return path.resolve(env.LIFE_VAULT_DIR || path.join(os.homedir(), 'Documents', 'Life'));
}
