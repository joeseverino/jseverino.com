// site land: merge one content PR and see it live. Reads the required
// status checks from main's ruleset and waits until each has reported and
// passed on the PR head, squash-merges (invoking land is the explicit request to merge),
// waits for the merge commit's Cloudflare Pages deployment, then verifies each
// published or edited writeup on production and that each removed one is
// gone. hq sync runs last, best-effort. Every wait polls real state against
// one deadline; nothing sleeps a fixed time hoping the deploy finished.
import fs from 'node:fs';
import path from 'node:path';
import { contentDiff } from '../content-diff.ts';
import { awaitChecks, passed, requiredContexts } from '../lib/github.ts';
import { preflight, type CheckName } from '../lib/preflight.ts';
import { run } from '../lib/run.ts';
import { SITE_REPOSITORY, writeupUrl } from '../../src/lib/site-config.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { EXIT, SiteError, requireReady, runScript, type Output } from './cli.ts';
import { git, gh, ghJson } from './git.ts';
import type { HqSync, LandResult, PullRequestRef, ScriptRun, Verified } from './types.ts';

const PR_FIELDS = 'number,url,title,state,headRefName,headRefOid,mergeCommit,isDraft';
const PAGES_CHECK = 'Cloudflare Pages';

// The PR_FIELDS gh returns.
interface PullRequest extends PullRequestRef {
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  headRefOid: string;
  mergeCommit: { oid: string } | null;
  isDraft: boolean;
}

// The most recently created content/* PR by the authenticated user.
function latestContentPr(root: string): PullRequest {
  const prs = ghJson<(PullRequest & { createdAt: string })[]>(root, 'pr', 'list', '--author', '@me', '--state', 'all', '--limit', '30',
    '--search', 'head:content/', '--json', `${PR_FIELDS},createdAt`)
    .filter((pr) => pr.headRefName.startsWith('content/'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [latest] = prs;
  if (!latest) throw new SiteError('no content PR found', { code: EXIT.usage, fix: 'pass the PR number: site land <pr>' });
  return latest;
}

function timeout(what: string, deadline: number, result: object): void {
  if (Date.now() < deadline) return;
  throw new SiteError(`timed out waiting for ${what}`, { code: EXIT.timeout, result, fix: 'rerun site land with a longer --timeout once the cause is clear' });
}

// Every context main's ruleset requires, reported and passed on the PR head.
// An empty requirement is an error: a fresh PR has reported nothing yet, so
// "nothing required" cannot be told apart from "nothing reported".
async function waitForChecks(pr: PullRequest, deadline: number, intervalMs: number, out: Output): Promise<void> {
  const required = requiredContexts(SITE_REPOSITORY, 'main');
  if (required.length === 0) {
    throw new SiteError('main\'s ruleset requires no status checks, so land cannot tell when the PR is ready', {
      result: { pr: pr.url },
      fix: 'add the required status checks to the main ruleset (docs/Release-Checklist.md)',
    });
  }
  const head = pr.headRefOid;
  out.step('checks', `waiting for ${required.length} required checks on #${pr.number} (${head.slice(0, 12)})`);
  const runs = await awaitChecks(SITE_REPOSITORY, head, required, { deadline, intervalMs, failFast: true });
  if (!runs) return timeout('the required checks', 0, { pr: pr.url });
  const byName = new Map(runs.map((check) => [check.name, check]));
  const failed = required.filter((name) => {
    const check = byName.get(name);
    return !check || !passed(check);
  });
  if (failed.length > 0) {
    const detail = failed.map((name) => `${name}=${byName.get(name)?.conclusion ?? byName.get(name)?.status ?? 'missing'}`).join(', ');
    throw new SiteError(`required checks failed on #${pr.number}: ${detail}`, {
      result: { pr: pr.url },
      fix: `fix the failing check, push to ${pr.headRefName}, then rerun site land ${pr.number}`,
    });
  }
  out.ok('checks', `${required.length} required checks passed`);
}

// The merge commit's Cloudflare Pages check-run, completed and successful.
async function waitForDeploy(sha: string, deadline: number, intervalMs: number, out: Output): Promise<void> {
  out.step('deploy', `waiting for ${PAGES_CHECK} on ${sha.slice(0, 12)}`);
  const runs = await awaitChecks(SITE_REPOSITORY, sha, [PAGES_CHECK], { deadline, intervalMs });
  const check = runs?.find((entry) => entry.name === PAGES_CHECK);
  if (!check) return timeout(`${PAGES_CHECK} on ${sha.slice(0, 12)}`, 0, { sha });
  if (check.conclusion !== 'success') {
    throw new SiteError(`${PAGES_CHECK} ${check.conclusion} for ${sha.slice(0, 12)}`, {
      result: { sha, details: check.details_url },
      fix: `inspect the deployment (${check.details_url}), fix it, and publish again`,
    });
  }
  out.ok('deploy', `${PAGES_CHECK} succeeded`);
}

const verifyLive = (slug: string, out: Output): Promise<ScriptRun> => runScript('bin/deploy-verify.ts', ['--slug', slug], { out, timeout: 5 * 60_000 });

async function verifyGone(slug: string): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(writeupUrl(slug), { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  return { ok: response.status === 404, status: response.status };
}

function onPath(name: string): boolean {
  return (process.env.PATH ?? '').split(path.delimiter).some((dir) => {
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

async function hqSync(root: string, out: Output): Promise<HqSync> {
  if (!onPath('hq')) return { ran: false };
  const result = await run('hq', ['sync'], { cwd: root, timeout: 10 * 60_000 });
  if (result.code === 0) {
    out.ok('hq', 'hq sync done');
    return { ran: true, ok: true };
  }
  out.warn('hq', `hq sync failed (the site is live regardless); retry: hq sync\n${result.output.trim()}`);
  return { ran: true, ok: false, retry: 'hq sync' };
}

export interface LandOptions {
  root?: string;
  pr?: string | undefined;
  timeoutMs?: number;
  intervalMs?: number;
  out: Output;
  checks?: CheckName[];
  verify?: (slug: string, out: Output) => Promise<Pick<ScriptRun, 'ok'>>;
  gone?: (slug: string) => Promise<{ ok: boolean; status: number }>;
  hq?: (root: string, out: Output) => Promise<HqSync>;
}

export async function land({
  root = siteRoot,
  pr: requested,
  timeoutMs = 30 * 60_000,
  intervalMs = 10_000,
  out,
  checks = ['gh', 'fetch'],
  verify = verifyLive,
  gone = verifyGone,
  hq = hqSync,
}: LandOptions): Promise<LandResult> {
  requireReady(await preflight(checks, { root }), out);
  const deadline = Date.now() + timeoutMs;
  let pr = requested ? ghJson<PullRequest>(root, 'pr', 'view', requested, '--json', PR_FIELDS) : latestContentPr(root);
  out.step('pr', `#${pr.number} ${pr.title} (${pr.state.toLowerCase()})`);

  if (pr.state === 'CLOSED') {
    throw new SiteError(`#${pr.number} is closed without merging`, { result: { pr: pr.url }, fix: 'reopen it or publish again' });
  }
  if (pr.state === 'OPEN') {
    if (pr.isDraft) throw new SiteError(`#${pr.number} is a draft`, { result: { pr: pr.url }, fix: `gh pr ready ${pr.number}` });
    await waitForChecks(pr, deadline, intervalMs, out);
    gh(root, 'pr', 'merge', String(pr.number), '--squash', '--delete-branch');
    out.ok('merge', `#${pr.number} squash-merged`);
    pr = ghJson<PullRequest>(root, 'pr', 'view', String(pr.number), '--json', PR_FIELDS);
    if (pr.state !== 'MERGED') {
      throw new SiteError(`#${pr.number} is ${pr.state.toLowerCase()} after the merge`, { result: { pr: pr.url } });
    }
  }

  const sha = pr.mergeCommit?.oid;
  if (!sha) throw new SiteError(`#${pr.number} has no merge commit`, { result: { pr: pr.url } });
  await waitForDeploy(sha, deadline, intervalMs, out);

  git(root, 'fetch', '--quiet', 'origin', 'main');
  const diff = contentDiff({ cwd: root, range: `${sha}^..${sha}` });
  const verified: Verified[] = [];
  for (const slug of [...diff.published, ...diff.edited]) {
    const result = await verify(slug, out);
    verified.push({ slug, ok: result.ok, url: writeupUrl(slug) });
    (result.ok ? out.ok : out.fail)('verify', `${slug} ${result.ok ? 'is live' : 'failed live verification'}`);
  }
  for (const slug of diff.removed) {
    const result = await gone(slug);
    verified.push({ slug, ok: result.ok, removed: true, status: result.status });
    (result.ok ? out.ok : out.fail)('verify', `${slug} ${result.ok ? 'returns 404' : `returns ${result.status}, expected 404`}`);
  }

  const result = { pr: pr.url, number: pr.number, sha, diff, verified };
  const failed = verified.filter((entry) => !entry.ok);
  if (failed.length > 0) {
    throw new SiteError(`live verification failed: ${failed.map((entry) => entry.slug).join(', ')}`, {
      result,
      fix: failed.map((entry) => `site verify ${entry.slug}`).join('; '),
    });
  }
  return { ok: true, status: 'landed', ...result, hq: await hq(root, out), next: null };
}
