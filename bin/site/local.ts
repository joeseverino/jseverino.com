// Repo-side commands: the dev server, status, and thin fronts for existing repo scripts.
import fs from 'node:fs';
import path from 'node:path';
import { buildOutDir, resolveBuiltDir } from '../../src/lib/build-output.ts';
import { CONTENT_BRANCH_PREFIX, DEFAULT_BRANCH, SITE_REPOSITORY } from '../../src/lib/site-config.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { draftsOverlay } from '../lib/cache.ts';
import { vaultRoot, WRITEUPS_FOLDER } from '../lib/local-paths.ts';
import { INSTALL_PACKAGES, lockfileDrift, preflight } from '../lib/preflight.ts';
import { BUILD_TIMEOUT_MS, run, SYNC_TIMEOUT_MS } from '../lib/run.ts';
import { assertSlug, EXIT, type Output, requireReady, runScript, SiteError } from './cli.ts';
import { servingDevServer } from './dev-server.ts';
import { repoState } from './git.ts';
import type { DevResult, DraftAltResult, PullRequestRef, ScriptRun, SeoResult, StatusResult, VerifyResult } from './types.ts';

export interface DevOptions {
  drafts: boolean;
  host?: string | undefined;
  port?: string | undefined;
  out: Output;
  root?: string;
}

// Under --json Astro's own output goes to stderr and Astro reports in JSON.
// When Astro detects an agent it serves in the background (astro dev
// --background) and exits; the lock file it leaves names the server.
export async function dev({ drafts, host, port, out, root = siteRoot }: DevOptions): Promise<DevResult> {
  requireReady(await preflight(drafts ? ['deps', 'vault'] : ['deps'], { root }), out);
  const env: NodeJS.ProcessEnv = {};
  if (drafts) {
    const synced = await runScript('bin/sync-content.ts', ['--drafts'], { out, timeout: SYNC_TIMEOUT_MS });
    if (!synced.ok) throw new SiteError('the drafts sync failed', { result: synced, fix: 'site validate --draft' });
    env.SITE_CONTENT_ROOT = path.relative(root, draftsOverlay());
  }
  const args = ['dev', ...(host ? ['--host', host] : []), ...(port ? ['--port', port] : []), ...(out.json ? ['--json'] : [])];
  out.step('dev', `astro dev${drafts ? ' with drafts from the overlay' : ''} (ctrl-c stops it)`);
  const result = await run('astro', args, { cwd: root, env, timeout: 0, stdio: out.json ? 'stderr' : 'inherit' });
  if (result.code !== 0 && result.code !== 130) throw new SiteError(`astro dev exited ${result.code}`, { result: { exitCode: result.code } });
  const server = result.code === 0 ? await servingDevServer(root) : null;
  if (server) out.ok('dev', `serving ${server.url} in the background (pid ${server.pid})`);
  return {
    drafts,
    background: server !== null,
    url: server?.url ?? null,
    pid: server?.pid ?? null,
    exitCode: result.code,
    next: server ? 'astro dev stop' : null,
  };
}

export async function status({ out, root = siteRoot }: { out: Output; root?: string }): Promise<StatusResult> {
  // gh is a network round trip, so the git probes run beside it.
  const [{ branch, changes: dirty, ahead, behind }, prs] = await Promise.all([
    repoState(root),
    run(
      'gh',
      ['pr', 'list', '--author', '@me', '--state', 'open', '--search', 'head:content/', '--json', 'number,url,title,headRefName', '-R', SITE_REPOSITORY],
      { cwd: root, timeout: 30_000 },
    ),
  ]);
  const drift = lockfileDrift(root);
  const vault = vaultRoot();
  const result = {
    repo: root,
    branch,
    dirty,
    ahead,
    behind,
    deps: { ok: drift.length === 0, drift: drift.slice(0, 10) },
    vault: { path: vault, ok: fs.existsSync(path.join(vault, WRITEUPS_FOLDER)) },
    built: resolveBuiltDir(root) !== null,
    draftsOverlay: fs.existsSync(draftsOverlay()),
    contentPrs: prs.code === 0 ? (JSON.parse(prs.stdout) as PullRequestRef[]).filter((pr) => pr.headRefName.startsWith(CONTENT_BRANCH_PREFIX)) : null,
  };
  out.step('repo', `${root} on ${result.branch ?? 'detached HEAD'}${dirty ? `, ${dirty} uncommitted` : ', clean'}`);
  const upstream = `origin/${DEFAULT_BRANCH}`;
  out.step(DEFAULT_BRANCH, ahead === null ? `${upstream} unknown (fetch first)` : `${ahead} ahead, ${behind} behind ${upstream} (as of the last fetch)`);
  (result.deps.ok ? out.step : out.warn)('deps', result.deps.ok ? 'match package-lock.json' : `stale: run ${INSTALL_PACKAGES} (${drift.length} differences)`);
  (result.vault.ok ? out.step : out.warn)('vault', result.vault.ok ? vault : `not found at ${vault}`);
  out.step('build', result.built ? `${buildOutDir}/ present` : 'not built');
  if (result.contentPrs === null) out.warn('prs', 'gh unavailable; open content PRs unknown');
  else if (result.contentPrs.length === 0) out.step('prs', 'no open content PRs');
  else for (const pr of result.contentPrs) out.step('pr', `#${pr.number} ${pr.title} ${pr.url}`);
  return {
    ...result,
    next: !result.deps.ok ? INSTALL_PACKAGES : result.contentPrs?.[0] ? `site land ${result.contentPrs[0].number}` : null,
  };
}

async function front(script: string, args: string[], { out, what }: { out: Output; what: string }): Promise<ScriptRun> {
  const result = await runScript(script, args, { out, timeout: BUILD_TIMEOUT_MS });
  if (!result.ok) throw new SiteError(`${what} failed`, { result });
  return result;
}

export async function verify({ slug: requested, origin, out }: { slug: string | undefined; origin: string | undefined; out: Output }): Promise<VerifyResult> {
  const slug = assertSlug(requested);
  const result = await front('bin/deploy-verify.ts', ['--slug', slug, ...(origin ? ['--origin', origin] : [])], { out, what: `live verification of ${slug}` });
  return { slug, ...result, next: `site seo ${slug}` };
}

export async function seo({ page, result: resultOnly, out }: { page: string | undefined; result: boolean; out: Output }): Promise<SeoResult> {
  if (!page) throw new SiteError('a page is required', { code: EXIT.usage, fix: 'site seo --help' });
  const result = await front('bin/seo-preview.ts', [...(resultOnly ? ['--result'] : []), page], { out, what: 'seo preview' });
  return { page, ...result, next: null };
}

export async function draftAlt({
  slug: requested,
  all,
  apply,
  out,
}: {
  slug: string | undefined;
  all: boolean;
  apply: boolean;
  out: Output;
}): Promise<DraftAltResult> {
  if (all === (requested !== undefined)) throw new SiteError('pass one writeup slug or --all', { code: EXIT.usage, fix: 'site draft-alt --help' });
  const slug = all ? null : assertSlug(requested);
  const result = await front('bin/draft-cover-alt.ts', [slug ?? '--all', ...(apply ? ['--apply'] : [])], { out, what: 'cover_alt draft' });
  const target = slug ?? '--all';
  return { slug, all, applied: apply, ...result, next: apply ? `site validate${slug ? ` ${slug}` : ''} --draft` : `site draft-alt ${target} --apply` };
}
