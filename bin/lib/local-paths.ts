// Sources outside this repo: an explicit override, then the default layout under the home directory.
//
//   VAULT_DIR, then NOTES_HOME   Labs vault          ~/Documents/Code/Severino Labs
//   LIFE_VAULT_DIR               Life vault          ~/Documents/Life
//   RESUME_ENGINE_DIR            resume-engine       ~/Code/Assets/resume-engine
//   EDUCATION_EXPORT_FILE        education export    none: `severino-vault-mcp export education` is run
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WRITEUPS_FOLDER = '05 Writeups';
export const PAGES_FOLDER = '06 Pages';

const home = (...segments: string[]): string => path.join(os.homedir(), ...segments);
const pick = (override: string | undefined, fallback: string): string => path.resolve(override || fallback);

export const vaultRoot = (env = process.env) =>
  pick(env.VAULT_DIR || env.NOTES_HOME, home('Documents', 'Code', 'Severino Labs'));
export const lifeVaultRoot = (env = process.env) => pick(env.LIFE_VAULT_DIR, home('Documents', 'Life'));
export const resumeEngineRoot = (env = process.env) => pick(env.RESUME_ENGINE_DIR, home('Code', 'Assets', 'resume-engine'));
// The directory an input resolved to, or one line saying which input is missing and how to point at it.
export function existingDir(label: string, dir: string, variable: string): string {
  if (!fs.existsSync(dir)) throw new Error(`${label} not found: ${dir} (set ${variable})`);
  return dir;
}

export const educationExportFile = (env = process.env): string | undefined => (env.EDUCATION_EXPORT_FILE ? path.resolve(env.EDUCATION_EXPORT_FILE) : undefined);
