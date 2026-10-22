// Checks a command runs first so it fails fast with the fix: deps, fetch, gh, vault, clean.
import fs from 'node:fs';
import path from 'node:path';
import { PAGES_FOLDER, WRITEUPS_FOLDER, vaultRoot } from './local-paths.ts';
import { run } from './run.ts';
import { readJson } from '../../src/lib/json.ts';
import { DEFAULT_BRANCH } from '../../src/lib/site-config.ts';
import { errorMessage } from '../../src/lib/error-message.ts';

interface LockEntry {
  version?: string;
  integrity?: string;
  optional?: boolean;
  devOptional?: boolean;
}

const lockPackages = (file: string): Record<string, LockEntry> =>
  readJson<{ packages?: Record<string, LockEntry> }>(file).packages ?? {};

// The clean install from the lockfile (mise.toml [deps.npm]). --force because
// the provider judges freshness by the lockfile's hash, while lockfileDrift
// compares every installed package, so it can find drift the provider calls fresh.
export const INSTALL_PACKAGES = 'mise deps install npm --force';

// Installed packages that differ from the lockfile. npm's hidden lockfile
// (node_modules/.package-lock.json) records what is installed; optional
// packages for another platform are legitimately absent.
export function lockfileDrift(root: string): string[] {
  const lockFile = path.join(root, 'package-lock.json');
  const installedFile = path.join(root, 'node_modules', '.package-lock.json');
  if (!fs.existsSync(installedFile)) return ['node_modules is not installed'];
  const locked = lockPackages(lockFile);
  const installed = lockPackages(installedFile);
  const drift: string[] = [];
  for (const [key, entry] of Object.entries(locked)) {
    if (!key) continue;
    const have = installed[key];
    if (!have) {
      if (!entry.optional && !entry.devOptional) drift.push(`${key} is missing`);
    } else if (entry.version && have.version !== entry.version) {
      drift.push(`${key} is ${have.version}, lockfile wants ${entry.version}`);
    } else if (entry.integrity && have.integrity && have.integrity !== entry.integrity) {
      drift.push(`${key} ${have.version} differs from the lockfile's integrity hash`);
    }
  }
  for (const key of Object.keys(installed)) {
    if (!(key in locked)) drift.push(`${key} is installed but not in the lockfile`);
  }
  return drift;
}

type CheckOutcome = { ok: true; detail: string } | { ok: false; detail: string; fix: string };
export type CheckName = 'deps' | 'fetch' | 'gh' | 'vault' | 'clean';
export type PreflightCheck = CheckOutcome & { name: CheckName };
export interface Preflight {
  ok: boolean;
  checks: PreflightCheck[];
  failed: Extract<PreflightCheck, { ok: false }>[];
}

const CHECKS: Record<CheckName, (context: { root: string }) => Promise<CheckOutcome>> = {
  async deps({ root }) {
    const drift = lockfileDrift(root);
    return drift.length === 0
      ? { ok: true, detail: 'node_modules matches package-lock.json' }
      : { ok: false, detail: `node_modules differs from package-lock.json (${drift.length}: ${drift.slice(0, 3).join('; ')})`, fix: `cd ${root} && ${INSTALL_PACKAGES}` };
  },
  async fetch({ root }) {
    const result = await run('git', ['fetch', '--quiet', 'origin', DEFAULT_BRANCH], { cwd: root, timeout: 60_000 });
    return result.code === 0
      ? { ok: true, detail: `fetched origin/${DEFAULT_BRANCH}` }
      : { ok: false, detail: `git fetch failed: ${result.stderr.trim()}`, fix: 'check the network and the origin remote, then retry' };
  },
  async gh({ root }) {
    const result = await run('gh', ['auth', 'status'], { cwd: root, timeout: 30_000 });
    return result.code === 0
      ? { ok: true, detail: 'gh is authenticated' }
      : { ok: false, detail: `gh is not authenticated: ${result.output.trim().split('\n').at(-1)}`, fix: 'gh auth login' };
  },
  async vault() {
    let root: string;
    try {
      root = vaultRoot();
    } catch (error) {
      return { ok: false, detail: errorMessage(error), fix: 'set VAULT_DIR in mise.local.toml [env]' };
    }
    const missing = [WRITEUPS_FOLDER, PAGES_FOLDER].filter((folder) => !fs.existsSync(path.join(root, folder)));
    return missing.length === 0
      ? { ok: true, detail: `vault at ${root}` }
      : { ok: false, detail: `vault not reachable: ${missing.map((folder) => path.join(root, folder)).join(', ')} missing`, fix: 'set VAULT_DIR to the vault root' };
  },
  async clean({ root }) {
    const result = await run('git', ['status', '--porcelain=v1', '--untracked-files=no'], { cwd: root });
    if (result.code !== 0) return { ok: false, detail: `git status failed: ${result.stderr.trim()}`, fix: `check that ${root} is a git checkout, then retry` };
    const dirty = result.stdout.split('\n').filter(Boolean);
    return dirty.length === 0
      ? { ok: true, detail: 'no uncommitted tracked changes' }
      : { ok: false, detail: `${dirty.length} uncommitted tracked change(s): ${dirty.slice(0, 3).map((line) => line.slice(3)).join(', ')}`, fix: 'commit or stash them, then retry' };
  },
};

// Runs the named checks concurrently: { ok, checks: [{ name, ok, detail, fix }], failed }.
export async function preflight(names: readonly CheckName[], { root }: { root: string }): Promise<Preflight> {
  const checks = await Promise.all(names.map(async (name): Promise<PreflightCheck> => ({ name, ...(await CHECKS[name]({ root })) })));
  const failed = checks.filter((check): check is Extract<PreflightCheck, { ok: false }> => !check.ok);
  return { ok: failed.length === 0, checks, failed };
}
