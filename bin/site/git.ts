// git and gh for publish/land. Every failure is fatal and carries the command's stderr.
import { git as gitQuery, statusEntries } from '../lib/git.ts';
import { runSync } from '../lib/run.ts';
import { SITE_REPOSITORY } from '../../src/lib/site-config.ts';
import { SiteError } from './cli.ts';
import { errorMessage } from '../../src/lib/error-message.ts';

function call(cmd: string, args: string[], spawn: () => string): string {
  try {
    return spawn();
  } catch (error) {
    throw new SiteError(`${cmd} ${args.slice(0, 2).join(' ')} failed: ${errorMessage(error)}`);
  }
}

export const git = (root: string, ...args: string[]): string => call('git', args, () => gitQuery(root, ...args));
// Every pr subcommand names the repo, so a fork or another remote is never the target.
export function gh(root: string, ...args: string[]): string {
  const full = args[0] === 'pr' ? [...args, '-R', SITE_REPOSITORY] : args;
  return call('gh', full, () => runSync('gh', full, { cwd: root }));
}
// The caller names the shape of the JSON it asked gh for with --json.
export const ghJson = <T>(root: string, ...args: string[]): T => JSON.parse(gh(root, ...args)) as T;

export function refExists(root: string, ref: string): boolean {
  try {
    gitQuery(root, 'rev-parse', '--verify', '--quiet', ref);
    return true;
  } catch {
    return false;
  }
}

// Paths changed in a worktree, tracked or not, relative to its root.
export const changedPaths = (root: string): string[] => statusEntries(root).map((entry) => entry.slice(3));
