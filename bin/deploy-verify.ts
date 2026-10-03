#!/usr/bin/env node
// Post-merge production verification, run from a residential IP (Bot Fight
// Mode challenges GitHub's runners). The response expectations come from
// src/lib/edge-expectations.ts, the same functions tests/edge asserts before
// a deploy, so "correct" means one thing on both sides of the release.
//
//   node bin/deploy-verify.ts                        # production, from a clean main
//   node bin/deploy-verify.ts --origin <url> [--preview]
//   node bin/deploy-verify.ts [--origin <url>] --slug <writeup>
//
// --origin verifies one Cloudflare Pages deployment (its <hash>.pages.dev URL,
// outside the zone, so Bot Fight Mode does not challenge a runner). It checks
// the served responses only: no git, audit, check-run, or code-scanning
// preconditions, and no HSTS (set at the zone, absent on pages.dev). --preview
// marks a branch preview, where sitedrift wraps every HTML route. --slug
// verifies one writeup after a publish: listed, served with headers, images resolve.
import fs from 'node:fs';
import path from 'node:path';
import { SITE, SITE_ORIGIN as siteOrigin, SITE_REPOSITORY as repository, writeupPath } from '../src/lib/site-config.ts';
import { siteRoot } from '../src/lib/site-root.ts';
import {
  cacheRuleFindings,
  contactRefusalFindings,
  cspFindings,
  headersToRecord,
  hstsFindings,
  nonceFromCsp,
  nonceParityFindings,
  placeholderFindings,
  scriptTagCount,
  staticCspFindings,
  staticHeaderFindings,
} from '../src/lib/edge-expectations.ts';
import { cli as parseCli } from './lib/args.ts';
import { git } from './lib/git.ts';
import { awaitChecks, openCodeScanningAlerts, passed, requiredContexts } from './lib/github.ts';
import { runSync, status } from './lib/run.ts';
import { annotate, appendSummary, endGroup, group, outcome, table, type Outcome } from './lib/step-summary.ts';
import { sitemapUrls } from '../src/lib/sitemap.ts';
import { ACCESS_ID_ENV, ACCESS_SECRET_ENV, accessHeaders, isAccessChallenge } from './lib/access.ts';

const { values: cli } = parseCli({
  usage: 'usage: node bin/deploy-verify.ts [--origin <url> [--preview]] [--slug <writeup>]',
  options: {
    origin: { type: 'string' },
    preview: { type: 'boolean', default: false },
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
// requests, plus the Pages build itself.
const PULL_REQUEST_ONLY = new Set(['dependency-review']);
const requiredChecks = (): string[] => [...new Set([
  ...requiredContexts(repository, 'main').filter((name) => !PULL_REQUEST_ONLY.has(name)),
  'Cloudflare Pages',
])];

const results: { name: string; ok: Outcome; detail: string }[] = [];


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

  group('remote      waiting for required checks and the Cloudflare Pages build');
  try {
    return await pollChecks(sha, deadline, started, (report) => {
      // Only log when the pending set changes; a line every ten seconds
      // buries the results under ninety copies of the same sentence.
      if (report === lastReport) return;
      lastReport = report;
      status('remote', `${report} (${Math.round((Date.now() - started) / 1000)}s)`);
    });
  } finally {
    endGroup();
  }
}

async function pollChecks(sha: string, deadline: number, started: number, report: (line: string) => void): Promise<string> {
  const names = requiredChecks();
  const checks = await awaitChecks(repository, sha, names, {
    deadline,
    onPending: ({ missing, pending }) => report(
      `waiting${missing.length ? `; not yet reported: ${missing.join(', ')}` : ''}${pending.length ? `; still running: ${pending.join(', ')}` : ''}`,
    ),
  });
  if (!checks) throw new Error('timed out waiting for required GitHub and Cloudflare checks');
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
  assertClean([...cspFindings(headers), ...staticHeaderFindings(headers), ...hsts], pathname);
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

async function verifyLiveRoutes(publicUrls: readonly string[]): Promise<string> {
  const failures: { url: string; status: number }[] = [];
  for (let index = 0; index < publicUrls.length; index += 8) {
    const batch = publicUrls.slice(index, index + 8);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const response = await fetchChecked(onTarget(url), { method: 'HEAD' });
        return { url, status: response.status };
      }),
    );
    failures.push(...batchResults.filter((result) => result.status !== 200));
  }
  if (failures.length > 0) {
    throw new Error(
      `live routes failed: ${failures.map(({ url, status: code }) => `${code} ${url}`).join(', ')}`,
    );
  }
  return `${publicUrls.length} sitemap URLs returned 200`;
}

// The middleware mints a nonce per request and stamps it on every script tag.
// A 200 whose scripts carry a different nonce than the header is a page that
// renders but executes nothing, which no status-code check would notice.
async function verifyNonce(): Promise<string> {
  const first = await fetchChecked(`${origin}/`);
  if (first.status !== 200) throw new Error(`/ returned ${first.status}, expected 200`);
  const nonce = nonceFromCsp(headersToRecord(first.headers)['content-security-policy']);
  const html = await first.text();
  assertClean(nonceParityFindings(html, nonce), '/');

  const second = await fetchChecked(`${origin}/`, { method: 'HEAD' });
  const rotated = nonceFromCsp(headersToRecord(second.headers)['content-security-policy']);
  if (!rotated || rotated === nonce) {
    throw new Error('nonce did not rotate between two requests; middleware bypassed or response cached');
  }
  return `${scriptTagCount(html)} script tags and the inlined stylesheet carry the header nonce; nonce rotates per request`;
}

// public/_headers pins fingerprinted assets for a year and keeps chrome assets
// revalidating; the home page names one of each.
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

  // Under an excluded prefix the asset server answers without the middleware:
  // the prefix's fallback page, under the static CSP from public/_headers.
  const asset = `/assets/deploy-verify-${Date.now().toString(36)}.png`;
  const miss = await fetchChecked(`${origin}${asset}`);
  if (miss.status !== 404) throw new Error(`${asset} returned ${miss.status}, expected 404`);
  const headers = headersToRecord(miss.headers);
  assertClean([...staticCspFindings(headers), ...staticHeaderFindings(headers), ...placeholderFindings(await miss.text())], asset);
  return 'unknown route returns a real 404; a miss under /assets/ carries the static CSP and no nonce placeholder';
}

// A well-formed submission with no Turnstile token must be refused before the
// honeypot, the Turnstile call, and the D1 write, so this probe stores nothing.
async function verifyContactGate(): Promise<string> {
  const response = await fetchChecked(`${origin}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'deploy-verify',
      email: `deploy-verify@${SITE.domain}`,
      message: 'Automated post-deploy probe. No verification token supplied.',
      sourceUrl: `${origin}/contact/`,
    }),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  assertClean(contactRefusalFindings(response.status, payload), 'POST /api/contact without a Turnstile token');
  return 'POST without a Turnstile token is refused with 400';
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
  // 404 from the Function; 403 once the zone's WAF rule blocks the path first
  // (cloudflare/zone.json, sitedrift-production).
  const sitedrift = await fetchChecked(`${origin}/__sitedrift/config.json`);
  if (![403, 404].includes(sitedrift.status)) {
    throw new Error(`production sitedrift route returned ${sitedrift.status}, expected 404 or 403`);
  }
  return `sitedrift route is ${sitedrift.status === 403 ? 'blocked at the zone' : 'absent'}`;
}

// One writeup, after a publish: listed in the sitemap, served with the
// security headers, and every image it references resolves.
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

function verifyCodeScanning(): string {
  const alerts = openCodeScanningAlerts(repository);
  if (alerts.length > 0) {
    throw new Error(`${alerts.length} open code-scanning alert(s) remain`);
  }
  return 'zero open code-scanning alerts';
}

async function run(name: string, check: () => string | Promise<string>): Promise<boolean> {
  try {
    const detail = await check();
    results.push({ name, ok: true, detail });
    status(name, detail);
    return true;
  } catch (error) {
    const { message } = error as Error;
    results.push({ name, ok: false, detail: message });
    status(name, `FAILED: ${message}`);
    annotate('error', `deploy-verify: ${name}`, message);
    return false;
  }
}

function skip(name: string, reason: string): void {
  results.push({ name, ok: null, detail: reason });
  status(name, `skipped: ${reason}`);
}

function writeSummary(sha: string): void {
  const failed = results.filter((result) => result.ok === false).length;
  appendSummary([
    `## Deploy verification for \`${sha.slice(0, 12)}\``,
    '',
    failed === 0
      ? `All ${results.length} checks passed against ${origin}.`
      : `${failed} of ${results.length} checks failed against ${origin}.`,
    '',
    table(
      ['Check', 'Result', 'Detail'],
      results.map((result) => [`\`${result.name}\``, outcome(result.ok), result.detail]),
    ),
  ].join('\n'));
}

async function verifyDeployment(): Promise<void> {
  const sha = process.env.DEPLOY_SHA ?? 'deployment';
  status('target', `${origin}${cli.preview ? ' (preview)' : ''}`);

  let publicUrls: string[] = [];
  const sitemapOk = await run('sitemap', async () => {
    publicUrls = await collectSitemapUrls();
    return `${publicUrls.length} URLs listed`;
  });

  const { slug } = cli;
  if (slug) {
    if (sitemapOk) await run('writeup', () => verifyWriteup(slug, publicUrls));
    else skip('writeup', 'sitemap unavailable');
  } else {
    if (sitemapOk) {
      await run('headers', async () => {
        await verifyHeaders('/');
        return 'CSP, report-only staging, and static security headers passed on /';
      });
      await run('routes', () => verifyLiveRoutes(publicUrls));
    } else {
      skip('headers', 'sitemap unavailable');
      skip('routes', 'sitemap unavailable');
    }
    if (cli.preview) {
      // Branch previews serve every HTML route through the sitedrift viewer,
      // so the page-markup checks have no site page to read there.
      const reason = 'branch previews serve HTML through the sitedrift viewer';
      skip('production', reason);
      skip('nonce', reason);
      skip('cache', reason);
    } else {
      await run('production', verifyProductionGuard);
      await run('nonce', verifyNonce);
      await run('cache', verifyCacheRules);
    }
    await run('not-found', verifyNotFound);
    await run('contact', verifyContactGate);
    await run('security-txt', verifySecurityTxt);
  }

  writeSummary(sha);
  const failed = results.filter((result) => result.ok === false);
  if (failed.length > 0) {
    throw new Error(`${failed.length} check(s) failed: ${failed.map((result) => result.name).join(', ')}`);
  }
  console.log(`\nok ${results.filter((result) => result.ok).length} checks passed against ${origin}`);
}

async function main(): Promise<void> {
  if (deployment || cli.slug) return verifyDeployment();
  if (git(siteRoot, 'status', '--porcelain')) {
    throw new Error('worktree is not clean; commit the verified release candidate first');
  }
  if (git(siteRoot, 'branch', '--show-current') !== 'main') {
    throw new Error('production deployment verification must run from main');
  }

  const sha = git(siteRoot, 'rev-parse', 'HEAD');
  const remote = git(siteRoot, 'ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0] ?? '';
  if (sha !== remote) {
    throw new Error(`local HEAD ${sha} does not match origin/main ${remote}`);
  }
  status('commit', `${sha.slice(0, 12)} is clean and pushed to main`);
  status('target', origin);

  await run('audit', () => {
    runSync('npm', ['audit', '--omit=dev', '--audit-level=high'], { cwd: siteRoot });
    return 'no high-severity production dependency advisories';
  });

  const deployed = await run('remote', () => waitForChecks(sha));

  // Headers are checked on the root page and on one deep writeup page, taken
  // from the live sitemap rather than a pinned slug so renaming a writeup
  // can't break deploy verification.
  let publicUrls: string[] = [];
  const sitemapOk = await run('sitemap', async () => {
    publicUrls = await collectSitemapUrls();
    return `${publicUrls.length} URLs listed`;
  });

  if (sitemapOk) {
    await run('headers', async () => {
      const writeupPath = publicUrls
        .map((url) => new URL(url).pathname)
        .find((pathname) => /^\/portfolio\/[^/]+\/?$/.test(pathname));
      if (!writeupPath) throw new Error('live sitemap lists no /portfolio/ writeup to header-check');
      await verifyHeaders('/');
      await verifyHeaders(writeupPath);
      return `CSP, report-only staging, static security headers, and HSTS passed (/ and ${writeupPath})`;
    });
    await run('routes', () => verifyLiveRoutes(publicUrls));
  } else {
    skip('headers', 'sitemap unavailable');
    skip('routes', 'sitemap unavailable');
  }

  await run('production', verifyProductionGuard);
  await run('nonce', verifyNonce);
  await run('cache', verifyCacheRules);
  await run('not-found', verifyNotFound);
  await run('contact', verifyContactGate);
  await run('security-txt', verifySecurityTxt);
  await run('security', verifyCodeScanning);

  writeSummary(sha);

  const failed = results.filter((result) => result.ok === false);
  if (failed.length > 0) {
    throw new Error(
      `${failed.length} check(s) failed: ${failed.map((result) => result.name).join(', ')}${deployed ? '' : ' (deployment never reached a verified state)'}`,
    );
  }

  const summary = `all ${results.length} checks passed for ${sha.slice(0, 12)} against ${origin}`;
  annotate('notice', 'deploy-verify', summary);
  console.log(
    '\nok deployed: pushed commit, remote checks, production guard, headers, routes, nonce, cache rules, 404, contact gate, security.txt, dependency audit, and code scanning passed',
  );
}

main().catch((error: unknown) => {
  console.error(`\nfailed: ${(error as Error).message}`);
  process.exit(1);
});
