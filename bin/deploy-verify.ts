#!/usr/bin/env node
// Post-merge production verification. Run from a residential IP (Bot Fight Mode
// challenges GitHub's runners). Expectations come from src/lib/edge-expectations.ts,
// shared with tests/edge.
//
//   node bin/deploy-verify.ts                        # production, from a clean main
//   node bin/deploy-verify.ts --origin <url> [--preview]
//   node bin/deploy-verify.ts [--origin <url>] --slug <writeup>
//
// --origin verifies one deployment, such as a Worker version at its preview URL (outside
// the zone, behind Access): served responses only, no git/check-run preconditions, no
// HSTS. --preview marks a branch preview, where sitedrift wraps every HTML route. --slug
// verifies one writeup after a publish.
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { DEFAULT_BRANCH, DEPLOY_CHECK, SITE, SITE_ORIGIN as siteOrigin, SITE_REPOSITORY as repository, writeupPath } from '../src/lib/site-config.ts';
import { siteRoot } from '../src/lib/site-root.ts';
import {
  cacheRuleFindings,
  contactRefusalFindings,
  cspFindings,
  headersToRecord,
  hstsFindings,
  inlineHashFindings,
  staticHeaderFindings,
} from '../src/lib/edge-expectations.ts';
import { cli as parseCli, flag } from './lib/args.ts';
import { routeFile } from './lib/dist.ts';
import { git } from './lib/git.ts';
import { awaitChecks, commitVerification, openCodeScanningAlerts, passed, requiredContexts } from './lib/github.ts';
import { spawnResult } from './lib/run.ts';
import { annotate, createReport, endGroup, group, status } from './lib/step-summary.ts';
import { sitemapUrls } from '../src/lib/sitemap.ts';
import { ACCESS_ID_ENV, ACCESS_SECRET_ENV, accessHeaders, isAccessChallenge } from './lib/access.ts';
import { errorMessage } from '../src/lib/error-message.ts';

const { values: cli } = parseCli({
  usage: 'usage: node bin/deploy-verify.ts [--origin <url> [--preview]] [--slug <writeup>]',
  options: {
    origin: { type: 'string' },
    preview: flag,
    slug: { type: 'string' },
  },
});
const origin = (cli.origin ?? siteOrigin).replace(/\/$/, '');
const deployment = Boolean(cli.origin);

// Sitemap <loc>s name the canonical origin; fetch them from the target.
const onTarget = (url: string): string => {
  const { pathname, search } = new URL(url);
  return `${origin}${pathname}${search}`;
};

// The main ruleset's required checks, less the ones that only run on pull
// requests. The deploy check is one of them, so main's commit is waited on until it is live.
const PULL_REQUEST_ONLY = new Set(['dependency-review']);
const requiredChecks = async (): Promise<string[]> =>
  (await requiredContexts(repository, DEFAULT_BRANCH)).filter((name) => !PULL_REQUEST_ONLY.has(name));

const production = !deployment && !cli.slug;
const report = createReport('Deploy verification', 'Check');

async function fetchChecked(url: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
    ...options,
    headers: { ...accessHeaders(url), ...Object.fromEntries(new Headers(options.headers)) },
  });
  if (isAccessChallenge(response)) {
    throw new Error(`${url}: Cloudflare Access asked for a login; set ${ACCESS_ID_ENV} and ${ACCESS_SECRET_ENV} to a service token the preview policy allows`);
  }
  return response;
}

function assertClean(findings: readonly string[], context: string): void {
  if (findings.length > 0) throw new Error(`${context}: ${findings.join('; ')}`);
}

async function waitForChecks(sha: string): Promise<string> {
  const deadline = Date.now() + 15 * 60_000;
  const started = Date.now();
  let lastReport = '';

  group(`remote      waiting for the required checks and the ${DEPLOY_CHECK} check`);
  try {
    return await pollChecks(sha, deadline, started, (report) => {
      // Log only when the pending set changes.
      if (report === lastReport) return;
      lastReport = report;
      status('remote', `${report} (${Math.round((Date.now() - started) / 1000)}s)`);
    });
  } finally {
    endGroup();
  }
}

async function pollChecks(sha: string, deadline: number, started: number, report: (line: string) => void): Promise<string> {
  const names = await requiredChecks();
  const checks = await awaitChecks(repository, sha, names, {
    deadline,
    onPending: ({ missing, pending }) => report(
      `waiting${missing.length ? `; not yet reported: ${missing.join(', ')}` : ''}${pending.length ? `; still running: ${pending.join(', ')}` : ''}`,
    ),
  });
  if (!checks) throw new Error('timed out waiting for the required checks');
  const failed = checks.filter((check) => check.status === 'completed' && !passed(check));
  if (failed.length > 0) {
    throw new Error(`remote checks failed: ${failed.map((check) => `${check.name}=${check.conclusion}`).join(', ')}`);
  }
  return `${names.length} required checks passed after ${Math.round((Date.now() - started) / 1000)}s`;
}

async function verifyHeaders(pathname: string): Promise<void> {
  const response = await fetchChecked(`${origin}${pathname}`, { method: 'HEAD' });
  if (response.status !== 200) {
    throw new Error(`${pathname} returned ${response.status}, expected 200`);
  }
  const headers = headersToRecord(response.headers);
  const hsts = deployment ? [] : hstsFindings(headers);
  assertClean([...cspFindings(headers, pathname), ...staticHeaderFindings(headers), ...hsts], pathname);
}

async function collectSitemapUrls(): Promise<string[]> {
  const index = `${origin}/sitemap-index.xml`;
  const publicUrls = await sitemapUrls(index, async (url) => {
    const response = await fetchChecked(url === index ? url : onTarget(url));
    if (response.status !== 200) {
      throw new Error(`${url === index ? 'live sitemap index' : url} returned ${response.status}`);
    }
    return response.text();
  });

  if (publicUrls.length === 0) throw new Error('live sitemap lists zero URLs');
  return publicUrls;
}

// A fresh deployment can 404 while it propagates, so a failed route is retried once.
const ROUTE_RETRY_MS = 5_000;

async function routeStatuses(urls: readonly string[]): Promise<{ url: string; status: number }[]> {
  const results: { url: string; status: number }[] = [];
  for (let index = 0; index < urls.length; index += 8) {
    results.push(...await Promise.all(urls.slice(index, index + 8).map(async (url) => {
      const response = await fetchChecked(url, { method: 'HEAD' });
      return { url, status: response.status };
    })));
  }
  return results;
}

async function verifyLiveRoutes(publicUrls: readonly string[]): Promise<string> {
  const notOk = (results: { url: string; status: number }[]) => results.filter((result) => result.status !== 200);
  let failures = notOk(await routeStatuses(publicUrls.map(onTarget)));
  if (failures.length > 0) {
    await sleep(ROUTE_RETRY_MS);
    failures = notOk(await routeStatuses(failures.map(({ url }) => url)));
  }
  if (failures.length > 0) {
    throw new Error(`routes failed: ${failures.map(({ url, status: code }) => `${code} ${url}`).join(', ')}`);
  }
  return `${publicUrls.length} sitemap URLs returned 200`;
}

// A 200 whose inline tags are not in the CSP header renders unthemed or unstyled.
async function verifyInlineHashes(): Promise<string> {
  const response = await fetchChecked(`${origin}/`);
  if (response.status !== 200) throw new Error(`/ returned ${response.status}, expected 200`);
  const csp = headersToRecord(response.headers)['content-security-policy'];
  assertClean(await inlineHashFindings(await response.text(), csp), '/');
  return 'the inline theme script and the inlined stylesheet are covered by the policy hashes';
}

async function verifyCacheRules(): Promise<string> {
  const home = await fetchChecked(`${origin}/`);
  const html = await home.text();
  const fingerprinted = html.match(/(?:src|href)="(\/_astro\/[^"]+)"/)?.[1];
  const chrome = html.match(/href="(\/assets\/icons\/[^"]+)"/)?.[1];
  if (!fingerprinted || !chrome) throw new Error('/ references no _astro asset or no icon to check cache rules on');

  for (const [pathname, immutable] of [[fingerprinted, true], [chrome, false]] as const) {
    const response = await fetchChecked(`${origin}${pathname}`, { method: 'HEAD' });
    if (response.status !== 200) throw new Error(`${pathname} returned ${response.status}, expected 200`);
    assertClean(cacheRuleFindings(headersToRecord(response.headers), { immutable }), pathname);
  }
  return `${fingerprinted} is immutable for a year; ${chrome} revalidates hourly`;
}

async function verifyNotFound(): Promise<string> {
  const probe = `/deploy-verify-${Date.now().toString(36)}`;
  const response = await fetchChecked(`${origin}${probe}`);
  if (response.status !== 404) {
    throw new Error(`${probe} returned ${response.status}, expected 404`);
  }

  const asset = `/assets/deploy-verify-${Date.now().toString(36)}.png`;
  const miss = await fetchChecked(`${origin}${asset}`);
  if (miss.status !== 404) throw new Error(`${asset} returned ${miss.status}, expected 404`);
  const headers = headersToRecord(miss.headers);
  assertClean([...cspFindings(headers), ...staticHeaderFindings(headers)], asset);
  return 'unknown route returns a real 404; a miss under /assets/ carries the policy and security headers';
}

// The dist branch holds the HTML the build produced; the site must serve the same bytes.
// A push to main publishes it a few minutes after the deploy, so a mismatch is retried.
async function verifyDist(urls: string[]): Promise<string> {
  const deadline = Date.now() + 6 * 60_000;
  for (;;) {
    git(siteRoot, 'fetch', '--quiet', 'origin', 'dist');
    const stale: string[] = [];
    for (const url of urls) {
      const { pathname } = new URL(url);
      const published = spawnResult('git', ['show', `FETCH_HEAD:${routeFile(pathname)}`], { cwd: siteRoot });
      if (published.code !== 0 || published.stdout !== await (await fetchChecked(onTarget(url))).text()) stale.push(pathname);
    }
    if (stale.length === 0) {
      const { verified, reason } = await commitVerification(repository, 'dist');
      if (!verified) throw new Error(`the dist branch tip is not signed (${reason})`);
      return `${urls.length} pages match the dist branch byte for byte, at a verified commit`;
    }
    if (Date.now() > deadline) throw new Error(`${stale.length} pages differ from the dist branch: ${stale.slice(0, 5).join(', ')}`);
    await sleep(20_000);
  }
}

// On the zone, API Shield refuses a body without turnstileToken before the function runs; a deployment
// outside the zone reaches the function. Neither probe stores anything: the function refuses first.
async function verifyContactGate(): Promise<string> {
  const submit = async (extra: Record<string, string>) => {
    const response = await fetchChecked(`${origin}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'deploy-verify',
        email: `deploy-verify@${SITE.domain}`,
        message: 'Automated post-deploy probe. No valid verification token supplied.',
        sourceUrl: `${origin}/contact/`,
        ...extra,
      }),
    });
    return { status: response.status, payload: await response.json().catch(() => ({})) as unknown };
  };

  const tokenless = await submit({});
  if (deployment) {
    assertClean(contactRefusalFindings(tokenless.status, tokenless.payload), 'POST /api/contact without a Turnstile token');
    return 'POST without a Turnstile token is refused with 400';
  }
  if (tokenless.status !== 403) throw new Error(`POST /api/contact without a Turnstile token: status ${tokenless.status}, expected API Shield to refuse it with 403`);
  const invalid = await submit({ turnstileToken: 'deploy-verify' });
  assertClean(contactRefusalFindings(invalid.status, invalid.payload), 'POST /api/contact with an invalid Turnstile token');
  return 'API Shield refuses a body without a token (403); the function refuses an invalid one (400)';
}

// The site key is a build-time variable; losing it still builds but ships `data-sitekey=""`.
async function verifyTurnstileKey(): Promise<string> {
  const html = await (await fetchChecked(`${origin}/contact/`)).text();
  const key = /data-sitekey="([^"]*)"/.exec(html)?.[1] ?? '';
  assertClean(/^[\w-]{16,}$/.test(key) ? [] : [`the contact form carries data-sitekey="${key}"`], '/contact/ Turnstile site key');
  return 'the contact form carries a Turnstile site key';
}

async function verifySecurityTxt(): Promise<string> {
  const response = await fetchChecked(`${origin}/.well-known/security.txt`);
  if (response.status !== 200) {
    throw new Error(`/.well-known/security.txt returned ${response.status}, expected 200`);
  }
  const live = await response.text();
  const committed = fs.readFileSync(path.join(siteRoot, 'public/.well-known/security.txt'), 'utf8');
  if (live !== committed) {
    throw new Error('live security.txt differs from the committed, signed file');
  }
  return 'live security.txt matches the committed, signed file';
}

async function verifyProductionGuard(): Promise<string> {
  // 404 from the Worker; 403 once the zone's WAF rule blocks the path first
  // (cloudflare/zone.json, sitedrift-production).
  const sitedrift = await fetchChecked(`${origin}/__sitedrift/config.json`);
  if (![403, 404].includes(sitedrift.status)) {
    throw new Error(`production sitedrift route returned ${sitedrift.status}, expected 404 or 403`);
  }
  return `sitedrift route is ${sitedrift.status === 403 ? 'blocked at the zone' : 'absent'}`;
}

async function verifyWriteup(slug: string, publicUrls: readonly string[]): Promise<string> {
  const pathname = writeupPath(slug);
  if (!publicUrls.some((url) => new URL(url).pathname === pathname)) {
    throw new Error(`${pathname} is not in the sitemap`);
  }
  await verifyHeaders(pathname);
  const html = await (await fetchChecked(`${origin}${pathname}`)).text();
  const images = [
    ...new Set(
      [...html.matchAll(/(?:src|srcset)="([^"]+)"/g)]
        .flatMap((match) => (match[1] ?? '').split(','))
        .map((candidate) => candidate.trim().split(/\s+/)[0] ?? '')
        .filter((url) => /^\/assets\/.+\.(?:avif|webp|png|jpe?g|gif|svg)$/i.test(url)),
    ),
  ];
  const broken: string[] = [];
  for (const image of images) {
    const response = await fetchChecked(`${origin}${image}`, { method: 'HEAD' });
    if (response.status !== 200) broken.push(`${response.status} ${image}`);
  }
  if (broken.length > 0) throw new Error(`broken images on ${pathname}: ${broken.join(', ')}`);
  return `${pathname} is listed, served with headers, and its ${images.length} image URLs resolve`;
}

// CodeQL only: Scorecard's Vulnerabilities finding stays open while an accepted advisory is in the lockfile.
async function verifyCodeScanning(): Promise<string> {
  const alerts = await openCodeScanningAlerts(repository, 'CodeQL');
  if (alerts.length > 0) {
    throw new Error(`${alerts.length} open CodeQL alert(s) remain`);
  }
  return 'zero open CodeQL alerts';
}

async function check(name: string, verify: () => string | Promise<string>): Promise<boolean> {
  try {
    const detail = await verify();
    report.add(name, true, detail);
    status(name, detail);
    return true;
  } catch (error) {
    const message = errorMessage(error);
    report.add(name, false, message);
    status(name, `FAILED: ${message}`);
    annotate('error', `deploy-verify: ${name}`, message);
    return false;
  }
}

function skip(name: string, reason: string): void {
  report.add(name, null, reason);
  status(name, `skipped: ${reason}`);
}

async function verifyPageHeaders(urls: readonly string[]): Promise<string> {
  const paths = ['/', '/contact/'];
  if (production) {
    const writeup = urls.map((url) => new URL(url).pathname).find((pathname) => /^\/portfolio\/[^/]+\/?$/.test(pathname));
    if (!writeup) throw new Error('live sitemap lists no /portfolio/ writeup to header-check');
    paths.push(writeup);
  }
  for (const pathname of paths) await verifyHeaders(pathname);
  return `CSP, Trusted Types staging, and static security headers${production ? ' and HSTS' : ''} passed on ${paths.join(', ')}`;
}

// Production runs from a clean main that matches origin, so the commit checked is the one deployed.
function releaseCandidate(): string {
  if (git(siteRoot, 'status', '--porcelain')) {
    throw new Error('worktree is not clean; commit the verified release candidate first');
  }
  if (git(siteRoot, 'branch', '--show-current') !== DEFAULT_BRANCH) {
    throw new Error('production deployment verification must run from main');
  }
  const sha = git(siteRoot, 'rev-parse', 'HEAD');
  const remote = git(siteRoot, 'ls-remote', 'origin', `refs/heads/${DEFAULT_BRANCH}`).split(/\s+/)[0] ?? '';
  if (sha !== remote) throw new Error(`local HEAD ${sha} does not match origin/main ${remote}`);
  status('commit', `${sha.slice(0, 12)} is clean and pushed to main`);
  return sha;
}

async function main(): Promise<void> {
  const sha = production ? releaseCandidate() : process.env.DEPLOY_SHA ?? 'deployment';
  status('target', `${origin}${cli.preview ? ' (preview)' : ''}`);

  let deployed = true;
  if (production) {
    deployed = await check('remote', () => waitForChecks(sha));
  }

  let urls: string[] = [];
  const sitemapOk = await check('sitemap', async () => {
    urls = await collectSitemapUrls();
    return `${urls.length} URLs listed`;
  });
  const fromSitemap = (name: string, verify: () => string | Promise<string>) =>
    sitemapOk ? check(name, verify) : skip(name, 'sitemap unavailable');

  const { slug } = cli;
  if (slug) {
    await fromSitemap('writeup', () => verifyWriteup(slug, urls));
  } else {
    await fromSitemap('headers', () => verifyPageHeaders(urls));
    await fromSitemap('routes', () => verifyLiveRoutes(urls));
    if (production) await fromSitemap('dist', () => verifyDist(urls));
    const served = [['production', verifyProductionGuard], ['inline', verifyInlineHashes], ['cache', verifyCacheRules], ['turnstile', verifyTurnstileKey]] as const;
    for (const [name, verify] of served) {
      if (cli.preview) skip(name, 'branch previews serve HTML through the sitedrift viewer');
      else await check(name, verify);
    }
    await check('not-found', verifyNotFound);
    await check('contact', verifyContactGate);
    await check('security-txt', verifySecurityTxt);
    if (production) await check('security', verifyCodeScanning);
  }

  const against = `for \`${sha.slice(0, 12)}\` against ${origin}`;
  const failed = report.failed();
  report.write(failed.length === 0
    ? `All ${report.rows.length} checks passed ${against}.`
    : `${failed.length} of ${report.rows.length} checks failed ${against}.`);
  if (failed.length > 0) {
    const stalled = deployed ? '' : ' (deployment never reached a verified state)';
    throw new Error(`${failed.length} check(s) failed: ${failed.map((row) => row.label).join(', ')}${stalled}`);
  }
  const summary = `${report.rows.filter((row) => row.ok).length} checks passed ${against}`;
  if (production) annotate('notice', 'deploy-verify', summary);
  console.log(`\nok ${summary}`);
}

main().catch((error: unknown) => {
  console.error(`\nfailed: ${errorMessage(error)}`);
  process.exit(1);
});
