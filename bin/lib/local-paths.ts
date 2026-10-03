// Where the authoring machine keeps the sources that live outside this repo.
// One answer for every script: an explicit override, then the default layout
// under the home directory. Nothing here is relative to the repo, so a clone
// or worktree anywhere resolves the same paths.
//
//   VAULT_DIR, then NOTES_HOME   Labs vault          ~/Documents/Code/Severino Labs
//   LIFE_VAULT_DIR               Life vault          ~/Documents/Life
//   RESUME_ENGINE_DIR            resume-engine       ~/Code/Assets/resume-engine
//   VAULT_MCP_DIR                severino-vault-mcp  ~/Code/Assets/severino-vault-mcp
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
export const vaultMcpRoot = (env = process.env) => pick(env.VAULT_MCP_DIR, home('Code', 'Assets', 'severino-vault-mcp'));
