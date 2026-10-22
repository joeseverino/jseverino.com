// site publish: the vault's public content as a PR against main, cut from origin/main in a temporary
// worktree so the checkout is never touched. Opens the PR and stops; merging is separate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commitMessage, contentDiff, describeDiff, isEmpty, type ContentDiff } from '../content-diff.ts';
import { preflight, type CheckName } from '../lib/preflight.ts';
import { BUILD_TIMEOUT_MS, GATE_TIMEOUT_MS, SYNC_TIMEOUT_MS, run, type RunOptions, type RunResult } from '../lib/run.ts';
import { CONTENT_BRANCH_PREFIX, DEFAULT_BRANCH, SITE_ORIGIN, SITE_REPOSITORY, writeupUrl } from '../../src/lib/site-config.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { EXIT, SiteError, requireReady, type Output } from './cli.ts';
import { changedPaths, ghInput, git, gitInput, refExists } from './git.ts';
import type { SyncReport } from '../content-sync/writer.ts';
import type { PublishCommitted, PublishResult } from './types.ts';
import { readJson } from '../../src/lib/json.ts';
import { errorMessage } from '../../src/lib/error-message.ts';

const pad = (n: number): string => String(n).padStart(2, '0');
const branchName = (now: Date): string =>
  `${CONTENT_BRANCH_PREFIX}${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

// A branch name free both locally and on origin.
function freshBranch(root: string, now: Date): string {
  const base = branchName(now);
  const remote = new Set(
    git(root, 'ls-remote', '--heads', 'origin', `${base}*`).split('\n').filter(Boolean)
      .map((line) => (line.split('\t')[1] ?? '').replace('refs/heads/', '')),
  );
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!remote.has(name) && !refExists(root, `refs/heads/${name}`)) return name;
  }
}

async function step(label: string, cmd: string, args: string[], options: RunOptions): Promise<RunResult> {
  const result = await run(cmd, args, options);
  if (result.code !== 0) {
    throw new SiteError(`${label} failed${result.timedOut ? ' (timed out)' : ''}:\n${result.output.trim()}`);
  }
  return result;
}

// The worktree shares the checkout's install when the lockfiles match.
async function linkDependencies(root: string, worktree: string, out: Output): Promise<void> {
  const lock = (dir: string): string => fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8');
  if (lock(root) === lock(worktree) && fs.existsSync(path.join(root, 'node_modules'))) {
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(worktree, 'node_modules'), 'dir');
    return;
  }
  out.step('deps', 'the branch has a different lockfile; installing in the worktree');
  await step('npm ci', 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: worktree, timeout: BUILD_TIMEOUT_MS });
}

interface StageContext {
  root: string;
  worktree: string;
  scratch: string;
  out: Output;
}

// The worktree's own sync (the branch's code), reporting the files it owns.
async function syncInWorktree({ root, worktree, scratch }: StageContext): Promise<SyncReport> {
  const reportFile = path.join(scratch, 'sync-report.json');
  await step('content sync', process.execPath, ['bin/sync-content.ts', '--report', reportFile], {
    cwd: worktree,
    env: { SITE_CACHE_DIR: path.join(root, '.cache') },
    timeout: SYNC_TIMEOUT_MS,
  });
  return readJson<SyncReport>(reportFile);
}

export type GateContext = Pick<StageContext, 'root' | 'worktree' | 'out'> & { full: boolean };

// CI runs the full build and browser suites on the PR, so locally the static gates are enough;
// --full also builds and runs the gates on the build (`mise run check`). The worktree is
// this repository's own fresh checkout, so its mise.toml is trusted for the run.
async function gateInWorktree({ worktree, full, out }: GateContext): Promise<void> {
  const options = { cwd: worktree, env: { MISE_TRUSTED_CONFIG_PATHS: worktree } };
  if (full) {
    await step('check', 'mise', ['run', 'check'], { ...options, timeout: GATE_TIMEOUT_MS });
    out.ok('gate', 'mise run check passed (--full)');
    return;
  }
  await step('fast gate', 'mise', ['run', 'fast'], { ...options, timeout: BUILD_TIMEOUT_MS });
  out.ok('gate', 'mise run fast passed');
}

// Changes the sync did not declare mean it wrote something publish would not
// stage. That is a bug, so publish stops on it.
function assertDeclared(worktree: string, declared: ReadonlySet<string>, when: string): void {
  const undeclared = changedPaths(worktree).filter((file) => !declared.has(file));
  if (undeclared.length > 0) {
    throw new SiteError(`${when} changed files the sync did not declare: ${undeclared.slice(0, 10).join(', ')}`);
  }
}

function prBody(diff: ContentDiff, { origin = SITE_ORIGIN } = {}): string {
  const writeup = (slug: string): string => `- [\`${slug}\`](${writeupUrl(slug, origin)})`;
  const page = (slug: string): string => {
    if (slug === 'technology-groups') return '- `technology-groups` (the technology catalog)';
    return `- [\`${slug}\`](${origin}${slug === 'home' ? '/' : `/${slug}/`})`;
  };
  const sections = ([
    ['Published', diff.published.map(writeup)],
    ['Edited', diff.edited.map(writeup)],
    ['Removed (these URLs will return 404)', diff.removed.map((slug) => `- \`${slug}\`: ${writeupUrl(slug, origin)}`)],
    ['Pages', diff.pages.map(page)],
  ] satisfies [string, string[]][]).filter(([, lines]) => lines.length > 0);

  const byFolder = new Map<string, number>();
  for (const file of diff.generated.paths) {
    const folder = file.split('/').slice(0, 4).join('/');
    byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
  }

  return [
    '## Content',
    '',
    ...sections.flatMap(([heading, lines]) => [`**${heading}**`, '', ...lines, '']),
    'The URLs go live when this merges. Until then, the Cloudflare Pages check on this PR links a preview deployment of this commit.',
    '',
    ...(diff.generated.count > 0
      ? [
          `<details><summary>${diff.generated.count} generated files (image masters)</summary>`,
          '',
          ...[...byFolder].map(([folder, count]) => `- \`${folder}\`: ${count}`),
          '',
          '</details>',
          '',
        ]
      : []),
    'Opened by `site publish`.',
  ].join('\n');
}

const DEFAULT_CHECKS: CheckName[] = ['deps', 'fetch', 'gh', 'vault', 'clean'];

interface PublishOptions {
  root?: string;
  from?: string | undefined;
  dryRun?: boolean;
  full?: boolean;
  out: Output;
  now?: Date;
  checks?: CheckName[];
  sync?: (context: StageContext) => Promise<SyncReport>;
  gate?: (context: GateContext) => Promise<void>;
}

// out: a createOutput(); sync/gate are injectable for tests.
export async function publish({
  root = siteRoot,
  from,
  dryRun = false,
  full = false,
  out,
  now = new Date(),
  checks = dryRun ? DEFAULT_CHECKS.filter((name) => name !== 'gh') : DEFAULT_CHECKS,
  sync = syncInWorktree,
  gate = gateInWorktree,
}: PublishOptions): Promise<PublishResult> {
  requireReady(await preflight(checks, { root }), out);

  const start = from ?? `origin/${DEFAULT_BRANCH}`;
  if (!refExists(root, start)) throw new SiteError(`no such ref: ${start}`, { code: EXIT.usage });
  const branch = freshBranch(root, now);
  const warnings: string[] = [];
  const attempt = cleanupStep(warnings, out);
  let outcome: { result: PublishResult } | { error: unknown };
  {
    // The worktree and the sync report share one scratch directory outside
    // the repo, removed when this block ends. git names worktrees by their
    // real path, and the temp directory is a symlink on macOS.
    using scratchDir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), 'site-publish-'));
    const scratch = fs.realpathSync(scratchDir.path);
    const worktree = path.join(scratch, 'worktree');
    outcome = await publishInWorktree({ root, start, branch, worktree, scratch, dryRun, full, out, sync, gate })
      .then((result) => ({ result }), (error: unknown) => ({ error }));
    attempt('removing the worktree', 'run: git worktree prune', () => {
      if (fs.existsSync(worktree)) git(root, 'worktree', 'remove', '--force', worktree);
    });
  }
  // After the scratch directory is gone, so prune also clears a worktree the remove left.
  attempt('pruning worktrees', 'run: git worktree prune', () => git(root, 'worktree', 'prune'));
  attempt(`deleting the local branch ${branch}`, `run: git branch -D ${branch}`, () => {
    if (refExists(root, `refs/heads/${branch}`)) git(root, 'branch', '--quiet', '-D', branch);
  });
  if ('error' in outcome) {
    if (outcome.error instanceof SiteError && warnings.length > 0) outcome.error.result = { ...outcome.error.result, cleanup: warnings };
    throw outcome.error;
  }
  return warnings.length > 0 ? { ...outcome.result, cleanup: warnings } : outcome.result;
}

interface PublishRun {
  root: string;
  start: string;
  branch: string;
  worktree: string;
  scratch: string;
  dryRun: boolean;
  full: boolean;
  out: Output;
  sync: (context: StageContext) => Promise<SyncReport>;
  gate: (context: GateContext) => Promise<void>;
}

async function publishInWorktree({ root, start, branch, worktree, scratch, dryRun, full, out, sync, gate }: PublishRun): Promise<PublishResult> {
  git(root, 'worktree', 'add', '--quiet', '--no-track', '-b', branch, worktree, start);
  out.step('branch', `${branch} from ${start} (temporary worktree)`);
  await linkDependencies(root, worktree, out);

  const report = await sync({ root, worktree, scratch, out });
  const declared = new Set([...report.written, ...report.removed]);
  assertDeclared(worktree, declared, 'the sync');

  const diff = contentDiff({ cwd: worktree });
  if (isEmpty(diff)) {
    out.ok('publish', `nothing to publish: the vault matches ${start}`);
    return { ok: true, status: 'nothing-to-publish', changed: false, diff, next: null };
  }
  out.step('content', describeDiff(diff));

  await gate({ root, worktree, full, out });
  assertDeclared(worktree, declared, 'the gate');

  gitInput(worktree, `${[...declared].join('\0')}\0`, 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul');
  const message = commitMessage(diff);
  gitInput(worktree, `${message}\n`, 'commit', '--quiet', '--file=-');
  const commit = git(worktree, 'rev-parse', 'HEAD');
  assertDeclared(worktree, new Set(), 'the commit');
  out.ok('commit', `${commit.slice(0, 12)} ${message.split('\n')[0]}`);

  const body = prBody(diff);
  const result: PublishCommitted & { ok: true } = { ok: true, changed: true, branch, commit, message, diff, body };
  if (dryRun) {
    out.text(`\n${body}\n`);
    out.ok('dry-run', 'stopped before the push; the worktree and branch are removed');
    return { ...result, status: 'dry-run', dryRun: true, next: 'site publish' };
  }

  git(worktree, 'push', '--quiet', '--set-upstream', 'origin', branch);
  out.ok('push', `origin/${branch}`);
  const subject = message.split('\n')[0] ?? message;
  let pr: string;
  try {
    const created = ghInput(worktree, body, 'pr', 'create', '--base', DEFAULT_BRANCH, '--head', branch, '--title', subject, '--body-file', '-');
    pr = created.slice(created.lastIndexOf('\n') + 1);
  } catch (error) {
    throw new SiteError(`${errorMessage(error)}\norigin/${branch} was pushed and is still on the remote`, {
      result: { branch, commit, remoteBranch: branch },
      fix: `open the PR: gh pr create -R ${SITE_REPOSITORY} --base ${DEFAULT_BRANCH} --head ${branch}; or delete the branch: git push origin --delete ${branch}`,
    });
  }
  out.ok('pr', pr);
  return { ...result, status: 'pr-opened', pr, next: `review the preview deployment on the PR, then: site land ${pr.slice(pr.lastIndexOf('/') + 1)}` };
}

// Each cleanup step runs on its own, so one failure neither skips the rest
// nor replaces the error that ended the publish. Failures come back as
// warnings that name what is left and how to remove it.
function cleanupStep(warnings: string[], out: Output): (what: string, fix: string, action: () => void) => void {
  return (what, fix, action) => {
    try {
      action();
    } catch (error) {
      const warning = `${what} failed (${errorMessage(error).split('\n')[0]}); ${fix}`;
      warnings.push(warning);
      out.warn('cleanup', warning);
    }
  };
}
