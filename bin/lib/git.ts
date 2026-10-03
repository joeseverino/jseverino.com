// The git queries scripts share. Each throws with git's own stderr.
import { runSync } from './run.ts';

export const git = (root: string, ...args: string[]): string => runSync('git', args, { cwd: root });

// Tracked files, repo-relative, optionally narrowed by pathspecs.
export const trackedFiles = (root: string, ...pathspecs: string[]): string[] =>
  runSync('git', ['ls-files', '-z', '--', ...pathspecs], { cwd: root, raw: true }).split('\0').filter(Boolean);

// Porcelain v1 status entries ("XY path"), untracked files included, renames
// as delete plus add, optionally narrowed by pathspecs.
export const statusEntries = (root: string, ...pathspecs: string[]): string[] =>
  runSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--', ...pathspecs], { cwd: root, raw: true })
    .split('\0')
    .filter(Boolean);
