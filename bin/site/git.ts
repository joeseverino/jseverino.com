// git and gh for publish/land, where every failure is fatal and carries the
// command's stderr, and the working-tree state site status and site manage show.
import { gitAsync, git as gitQuery, statusEntries } from '../lib/git.ts';
import { runSync, spawnResult } from '../lib/run.ts';
import { DEFAULT_BRANCH, SITE_REPOSITORY } from '../../src/lib/site-config.ts';
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

// A command that reads its input on stdin (a pathspec list, a commit message, a PR body).
const piped = (cmd: string, root: string, input: string, args: string[]): string => call(cmd, args, () => {
  const result = spawnResult(cmd, args, { cwd: root, input });
  if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || result.error?.message || 'failed');
  return result.stdout.trim();
});
export const gitInput = (root: string, input: string, ...args: string[]): string => piped('git', root, input, args);

// Every pr subcommand names the repo, so a fork or another remote is never the target.
const ghArgs = (args: string[]): string[] => (args[0] === 'pr' ? [...args, '-R', SITE_REPOSITORY] : args);
export function gh(root: string, ...args: string[]): string {
  const full = ghArgs(args);
  return call('gh', full, () => runSync('gh', full, { cwd: root }));
}
export const ghInput = (root: string, input: string, ...args: string[]): string => piped('gh', root, input, ghArgs(args));
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

// What site status and the site manage Site tab show of a checkout. Every
// field is null when its probe fails: no commits, a detached HEAD, or no
// origin/main fetched yet.
export interface RepoState {
  branch: string | null;
  changes: number;
  // Against origin/main as of the last fetch.
  ahead: number | null;
  behind: number | null;
  commit: { hash: string; subject: string; age: string } | null;
}

const probe = (root: string, args: string[]): Promise<string | null> => gitAsync(root, ...args).catch(() => null);

// Three independent probes, run at once. porcelain=v2 --branch names the branch in its headers.
export async function repoState(root: string): Promise<RepoState> {
  const [status, counts, commit] = await Promise.all([
    probe(root, ['status', '--porcelain=v2', '--branch']),
    probe(root, ['rev-list', '--left-right', '--count', `HEAD...origin/${DEFAULT_BRANCH}`]),
    probe(root, ['log', '-1', '--format=%h%x09%s%x09%cr']),
  ]);
  const lines = (status ?? '').split('\n').filter(Boolean);
  const head = lines.find((line) => line.startsWith('# branch.head '))?.slice('# branch.head '.length);
  const [ahead, behind] = counts?.split(/\s+/).map(Number) ?? [];
  const [hash, subject, age] = commit?.split('\t') ?? [];
  return {
    branch: head && head !== '(detached)' ? head : null,
    changes: lines.filter((line) => !line.startsWith('#')).length,
    ahead: ahead ?? null,
    behind: behind ?? null,
    commit: hash && subject !== undefined && age !== undefined ? { hash, subject, age } : null,
  };
}
