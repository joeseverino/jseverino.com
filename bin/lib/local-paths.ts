// Sources outside this repo, each named by an environment variable with no default: a machine's
// paths live in its gitignored mise.local.toml [env], never in this public repo.
//
//   VAULT_DIR, then NOTES_HOME   Labs vault
//   LIFE_VAULT_DIR               Life vault
//   RESUME_ENGINE_DIR            resume-engine checkout
//   EDUCATION_EXPORT_FILE        education export (optional: `severino-vault-mcp export education` is run)
import fs from 'node:fs';
import path from 'node:path';

export const WRITEUPS_FOLDER = '05 Writeups';
export const PAGES_FOLDER = '06 Pages';

type Env = Readonly<Record<string, string | undefined>>;

// The first variable set, resolved; unset, one line naming the variable and where it goes.
function required(env: Env, label: string, ...variables: [string, ...string[]]): string {
  const value = variables.map((name) => env[name]).find(Boolean);
  if (!value) throw new Error(`${label} not configured: set ${variables[0]} in mise.local.toml [env]`);
  return path.resolve(value);
}

export const vaultRoot = (env: Env = process.env): string => required(env, 'vault', 'VAULT_DIR', 'NOTES_HOME');
export const lifeVaultRoot = (env: Env = process.env): string => required(env, 'life vault', 'LIFE_VAULT_DIR');
export const resumeEngineRoot = (env: Env = process.env): string => required(env, 'resume-engine', 'RESUME_ENGINE_DIR');

// The directory an input resolved to, or one line saying which input is missing and how to point at it.
export function existingDir(label: string, dir: string, variable: string): string {
  if (!fs.existsSync(dir)) throw new Error(`${label} not found: ${dir} (set ${variable})`);
  return dir;
}

export const educationExportFile = (env: Env = process.env): string | undefined => (env.EDUCATION_EXPORT_FILE ? path.resolve(env.EDUCATION_EXPORT_FILE) : undefined);
