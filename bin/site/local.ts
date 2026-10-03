// The repo-side commands: the dev server, repository status, and thin fronts
// for the repo scripts that already own their logic (deploy-verify,
// seo-preview, draft-cover-alt).
import fs from 'node:fs';
import path from 'node:path';
import { draftsOverlay } from '../lib/cache.ts';
import { lockfileDrift, preflight } from '../lib/preflight.ts';
import { SYNC_TIMEOUT_MS, run } from '../lib/run.ts';
import { vaultRoot, WRITEUPS_FOLDER } from '../lib/local-paths.ts';
import { buildOutDir } from '../../src/lib/build-output.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { SiteError, assertSlug, requireReady, runScript, type Output } from './cli.ts';
import type { DevResult, DraftAltResult, PullRequestRef, ScriptRun, SeoResult, StatusResult, VerifyResult } from './types.ts';
import { liveDevServer } from './dev-server.ts';

export interface DevOptions {
  drafts: boolean;
  host?: string | undefined;
  port?: string | undefined;
  out: Output;
  root?: string;
}

// Under --json Astro's own output goes to stderr and Astro reports in JSON.
// When Astro detects an agent it serves from a detached process and exits;
// the lock file it leaves names the server.
export async function dev({ drafts, host, port, out, root = siteRoot }: DevOptions): Promise<DevResult> {
  requireReady(await preflight(drafts ? ['deps', 'vault'] : ['deps'], { root }), out);
  const env: NodeJS.ProcessEnv = { ASTRO_TELEMETRY_DISABLED: '1' };
  if (drafts) {
    const synced = await runScript('bin/sync-content.ts', ['--drafts'], { out, timeout: SYNC_TIMEOUT_MS });
    if (!synced.ok) throw new SiteError('the drafts sync failed', { result: synced, fix: 'site validate --draft' });
    env.SITE_CONTENT_ROOT = path.relative(root, draftsOverlay());
  }
  const args = ['astro', 'dev', ...(host ? ['--host', host] : []), ...(port ? ['--port', port] : []), ...(out.json ? ['--json'] : [])];
  out.step('dev', `astro dev${drafts ? ' with drafts from the overlay' : ''} (ctrl-c stops it)`);
  const result = await run('npx', args, { cwd: root, env, timeout: 0, stdio: out.json ? 'stderr' : 'inherit' });
  if (result.code !== 0 && result.code !== 130) throw new SiteError(`astro dev exited ${result.code}`, { result: { exitCode: result.code } });
  const server = result.code === 0 ? liveDevServer(root) : null;
  if (server) out.ok('dev', `serving ${server.url} in the background (pid ${server.pid})`);
  return {
    drafts,
    background: server !== null,
    url: server?.url ?? null,
    pid: server?.pid ?? null,
    exitCode: result.code,
    next: server ? 'npx astro dev stop' : null,
  };
}

const gitLine = async (root: string, args: string[]): Promise<string | null> => {
  const result = await run('git', args, { cwd: root });
  return result.code === 0 ? result.stdout.trim() : null;
};

export async function status({ out, root = siteRoot }: { out: Output; root?: string }): Promise<StatusResult> {
  // Independent probes; gh is a network round trip, so nothing waits on it.
  const [branch, porcelain, counts, prs] = await Promise.all([
    gitLine(root, ['branch', '--show-current']),
    gitLine(root, ['status', '--porcelain=v1']),
    gitLine(root, ['rev-list', '--left-right', '--count', 'HEAD...origin/main']),
    run('gh', ['pr', 'list', '--author', '@me', '--state', 'open', '--search', 'head:content/', '--json', 'number,url,title,headRefName'], { cwd: root, timeout: 30_000 }),
  ]);
  const dirty = (porcelain ?? '').split('\n').filter(Boolean).length;
  const [ahead = null, behind = null] = counts ? counts.split(/\s+/).map(Number) : [];
  const drift = lockfileDrift(root);
  const vault = vaultRoot();
  const result = {
    repo: root,
    branch: branch || null,
    dirty,
    ahead,
    behind,
    deps: { ok: drift.length === 0, drift: drift.slice(0, 10) },
    vault: { path: vault, ok: fs.existsSync(path.join(vault, WRITEUPS_FOLDER)) },
    built: fs.existsSync(path.join(root, buildOutDir)),
    draftsOverlay: fs.existsSync(draftsOverlay()),
    contentPrs: prs.code === 0 ? (JSON.parse(prs.stdout) as PullRequestRef[]).filter((pr) => pr.headRefName.startsWith('content/')) : null,
  };
  out.step('repo', `${root} on ${result.branch ?? 'detached HEAD'}${dirty ? `, ${dirty} uncommitted` : ', clean'}`);
  out.step('main', ahead === null ? 'origin/main unknown (fetch first)' : `${ahead} ahead, ${behind} behind origin/main (as of the last fetch)`);
  (result.deps.ok ? out.step : out.warn)('deps', result.deps.ok ? 'match package-lock.json' : `stale: run npm ci (${drift.length} differences)`);
  (result.vault.ok ? out.step : out.warn)('vault', result.vault.ok ? vault : `not found at ${vault}`);
  out.step('build', result.built ? `${buildOutDir}/ present` : 'not built');
  if (result.contentPrs === null) out.warn('prs', 'gh unavailable; open content PRs unknown');
  else if (result.contentPrs.length === 0) out.step('prs', 'no open content PRs');
  else for (const pr of result.contentPrs) out.step('pr', `#${pr.number} ${pr.title} ${pr.url}`);
  return {
    ...result,
    next: !result.deps.ok ? 'npm ci' : result.contentPrs?.[0] ? `site land ${result.contentPrs[0].number}` : null,
  };
}

async function front(script: string, args: string[], { out, what }: { out: Output; what: string }): Promise<ScriptRun> {
  const result = await runScript(script, args, { out, timeout: 10 * 60_000 });
  if (!result.ok) throw new SiteError(`${what} failed`, { result });
  return result;
}

export async function verify({ slug: requested, origin, out }: { slug: string | undefined; origin: string | undefined; out: Output }): Promise<VerifyResult> {
  const slug = assertSlug(requested);
  const result = await front('bin/deploy-verify.ts', ['--slug', slug, ...(origin ? ['--origin', origin] : [])], { out, what: `live verification of ${slug}` });
  return { slug, ...result, next: `site seo ${slug}` };
}

export async function seo({ page, result: resultOnly, out }: { page: string; result: boolean; out: Output }): Promise<SeoResult> {
  const result = await front('bin/seo-preview.ts', [...(resultOnly ? ['--result'] : []), page], { out, what: 'seo preview' });
  return { page, ...result, next: null };
}

export async function draftAlt({ slug: requested, apply, out }: { slug: string | undefined; apply: boolean; out: Output }): Promise<DraftAltResult> {
  const slug = assertSlug(requested);
  const result = await front('bin/draft-cover-alt.ts', [slug, ...(apply ? ['--apply'] : [])], { out, what: 'cover_alt draft' });
  return { slug, applied: Boolean(apply), ...result, next: apply ? `site validate ${slug} --draft` : `site draft-alt ${slug} --apply` };
}
