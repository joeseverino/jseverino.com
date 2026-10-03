// site publish: the vault's current public content as a pull request against
// main. The branch is cut from origin/main in a temporary worktree, so the
// checkout (whatever branch it is on, however stale) is never touched; the
// commit holds exactly the files the sync declares; the PR body speaks in
// slugs and URLs. It opens the PR and stops: merging is a separate step.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { commitMessage, contentDiff, describeDiff, isEmpty, type ContentDiff } from '../content-diff.ts';
import { runAudit } from '../lib/audits.ts';
import { preflight, type CheckName } from '../lib/preflight.ts';
import { SYNC_TIMEOUT_MS, run, type RunOptions, type RunResult } from '../lib/run.ts';
import type { Audit } from '../../tests/audits/registry.ts';
import { SITE_ORIGIN, writeupUrl } from '../../src/lib/site-config.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { EXIT, SiteError, requireReady, type Output } from './cli.ts';
import { changedPaths, gh, git, refExists } from './git.ts';
import type { SyncReport } from '../content-sync/writer.ts';
import type { PublishCommitted, PublishResult } from './types.ts';
import { readJson } from '../../src/lib/json.ts';

const pad = (n: number): string => String(n).padStart(2, '0');
export const branchName = (now: Date): string =>
  `content/${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

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
  out.step('deps', 'origin/main has a different lockfile; installing in the worktree');
  await step('npm ci', 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: worktree, timeout: 10 * 60_000 });
}

// The worktree's own sync (main's code), reporting the files it owns.
export interface StageContext {
  root: string;
  worktree: string;
  scratch: string;
  out: Output;
}

async function syncInWorktree({ root, worktree, scratch }: StageContext): Promise<SyncReport> {
  const reportFile = path.join(scratch, 'sync-report.json');
  await step('content sync', process.execPath, ['bin/sync-content.ts', '--report', reportFile], {
    cwd: worktree,
    env: { SITE_CACHE_DIR: path.join(root, '.cache') },
    timeout: SYNC_TIMEOUT_MS,
  });
  return readJson<SyncReport>(reportFile);
}

// CI runs the full build and browser suites on the PR. Locally: the fast gate,
// plus the audits CI cannot run (they read sources only this machine has).
// --full runs the whole publish gate instead.
export type GateContext = Pick<StageContext, 'root' | 'worktree' | 'out'> & { full: boolean };

async function gateInWorktree({ worktree, full, out }: GateContext): Promise<void> {
  if (full) {
    await step('publish gate', process.execPath, ['bin/publish-check.ts', '--no-sync'], { cwd: worktree, timeout: 30 * 60_000 });
    out.ok('gate', 'publish gate passed (--full)');
    return;
  }
  await step('fast gate', process.execPath, ['bin/gate-check.ts'], { cwd: worktree, timeout: 10 * 60_000 });
  // The worktree's own registry, so the audits are main's.
  const { AUDITS } = await import(pathToFileURL(path.join(worktree, 'tests/audits/registry.ts')).href) as { AUDITS: readonly Audit[] };
  for (const audit of AUDITS.filter((entry) => entry.localOnly && !entry.gates.includes('gate'))) {
    const result = await runAudit(audit, { cwd: worktree, ci: false });
    if (result.ok === false) throw new SiteError(`${audit.label} failed: ${result.detail}\n${result.output.trim()}`);
  }
  out.ok('gate', 'fast gate and local-only audits passed');
}

// Changes the sync did not declare mean it wrote something publish would not
// stage. That is a bug, so publish stops on it.
function assertDeclared(worktree: string, declared: ReadonlySet<string>, when: string): void {
  const undeclared = changedPaths(worktree).filter((file) => !declared.has(file));
  if (undeclared.length > 0) {
    throw new SiteError(`${when} changed files the sync did not declare: ${undeclared.slice(0, 10).join(', ')}`);
  }
}

export function prBody(diff: ContentDiff, { origin = SITE_ORIGIN } = {}): string {
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

export interface PublishOptions {
  root?: string;
  base?: string;
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
  base = 'main',
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

  const start = from ?? `origin/${base}`;
  if (!refExists(root, start)) throw new SiteError(`no such ref: ${start}`, { code: EXIT.usage });
  const branch = freshBranch(root, now);
  // The worktree and the files publish writes beside it (report, pathspec,
  // message, body) share one scratch directory outside the repo.
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'site-publish-')));
  const worktree = path.join(scratch, 'worktree');

  let result: PublishResult;
  try {
    result = await publishInWorktree({ root, base, start, branch, worktree, scratch, dryRun, full, out, sync, gate });
  } catch (error) {
    const warnings = cleanUp(root, worktree, branch, scratch, out);
    if (error instanceof SiteError && warnings.length > 0) error.result = { ...error.result, cleanup: warnings };
    throw error;
  }
  const warnings = cleanUp(root, worktree, branch, scratch, out);
  return warnings.length > 0 ? { ...result, cleanup: warnings } : result;
}

interface PublishRun {
  root: string;
  base: string;
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

async function publishInWorktree({ root, base, start, branch, worktree, scratch, dryRun, full, out, sync, gate }: PublishRun): Promise<PublishResult> {
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

  const pathspec = path.join(scratch, 'pathspec');
  fs.writeFileSync(pathspec, `${[...declared].join('\0')}\0`);
  git(worktree, 'add', '-A', '--pathspec-from-file', pathspec, '--pathspec-file-nul');
  const message = commitMessage(diff);
  const messageFile = path.join(scratch, 'message');
  fs.writeFileSync(messageFile, `${message}\n`);
  git(worktree, 'commit', '--quiet', '--file', messageFile);
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
  const bodyFile = path.join(scratch, 'body.md');
  fs.writeFileSync(bodyFile, body);
  const subject = message.split('\n')[0] ?? message;
  let pr: string;
  try {
    pr = (gh(worktree, 'pr', 'create', '--base', base, '--head', branch, '--title', subject, '--body-file', bodyFile)
      .split('\n').at(-1) ?? '').trim();
  } catch (error) {
    throw new SiteError(`${(error as Error).message}\norigin/${branch} was pushed and is still on the remote`, {
      result: { branch, commit, remoteBranch: branch },
      fix: `open the PR: gh pr create --base ${base} --head ${branch}; or delete the branch: git push origin --delete ${branch}`,
    });
  }
  out.ok('pr', pr);
  return { ...result, status: 'pr-opened', pr, next: `review the preview deployment on the PR, then: site land ${pr.split('/').at(-1) ?? pr}` };
}

// Each step runs on its own, so one failure neither skips the rest nor
// replaces the error that ended the publish. Failures come back as warnings
// that name what is left and how to remove it.
function cleanUp(root: string, worktree: string, branch: string, scratch: string, out: Output): string[] {
  const warnings: string[] = [];
  const attempt = (what: string, fix: string, action: () => void): void => {
    try {
      action();
    } catch (error) {
      const warning = `${what} failed (${(error as Error).message.split('\n')[0]}); ${fix}`;
      warnings.push(warning);
      out.warn('cleanup', warning);
    }
  };
  attempt('removing the worktree', 'run: git worktree prune', () => {
    if (fs.existsSync(worktree)) git(root, 'worktree', 'remove', '--force', worktree);
  });
  attempt('removing the scratch directory', `delete ${scratch}`, () => fs.rmSync(scratch, { recursive: true, force: true }));
  // After the directory is gone, so prune also clears a worktree remove left.
  attempt('pruning worktrees', 'run: git worktree prune', () => git(root, 'worktree', 'prune'));
  attempt(`deleting the local branch ${branch}`, `run: git branch -D ${branch}`, () => {
    if (refExists(root, `refs/heads/${branch}`)) git(root, 'branch', '--quiet', '-D', branch);
  });
  return warnings;
}
