#!/usr/bin/env node
// Post-push production verification, run from a residential IP (Bot Fight
// Mode challenges GitHub's runners). The response expectations come from
// src/lib/edge-expectations.mjs, the same functions tests/edge asserts before
// a deploy, so "correct" means one thing on both sides of the release.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SITE } from '../src/lib/site-config.mjs';
import { siteRoot } from '../src/lib/site-root.mjs';
import {
  cacheRuleFindings,
  contactRefusalFindings,
  cspFindings,
  headersToRecord,
  hstsFindings,
  nonceFromCsp,
  nonceParityFindings,
  scriptTagCount,
  siteOrigin as origin,
  staticHeaderFindings,
} from '../src/lib/edge-expectations.mjs';
import { checkRuns, openCodeScanningAlerts } from './lib/github.mjs';
import { runSync, sleep, status } from './lib/run.mjs';
import { annotate, appendSummary, endGroup, group, outcome, table } from './lib/step-summary.mjs';

const repository = `${SITE.github}/${SITE.domain}`;
const requiredChecks = new Set([
  'build',
  'e2e',
  'visual',
  'edge',
  'analyze javascript-typescript',
  'Cloudflare Pages',
]);

const results = [];

const git = (...args) => runSync('git', args, { cwd: siteRoot });

function fetchChecked(url, options = {}) {
  return fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
    ...options,
  });
}

function assertClean(findings, context) {
  if (findings.length > 0) throw new Error(`${context}: ${findings.join('; ')}`);
}

async function waitForChecks(sha) {
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

async function pollChecks(sha, deadline, started, report) {
  while (Date.now() < deadline) {
    const checks = new Map(checkRuns(repository, sha).map((check) => [check.name, check]));
    const missing = [...requiredChecks].filter((name) => !checks.has(name));
    const pending = [...requiredChecks].filter(
      (name) => checks.get(name)?.status !== 'completed',
    );

    if (missing.length === 0 && pending.length === 0) {
      const failed = [...checks.values()].filter(
        (check) =>
          check.status === 'completed' &&
          !['success', 'neutral', 'skipped'].includes(check.conclusion),
      );
      if (failed.length > 0) {
        throw new Error(
          `remote checks failed: ${failed.map((check) => `${check.name}=${check.conclusion}`).join(', ')}`,
        );
      }
      return `${requiredChecks.size} required checks passed after ${Math.round((Date.now() - started) / 1000)}s`;
    }

    report(
      `waiting${missing.length ? `; not yet reported: ${missing.join(', ')}` : ''}${pending.length ? `; still running: ${pending.join(', ')}` : ''}`,
    );
    await sleep(10_000);
  }

  throw new Error('timed out waiting for required GitHub and Cloudflare checks');
}

async function verifyHeaders(pathname) {
  const response = await fetchChecked(`${origin}${pathname}`, { method: 'HEAD' });
  if (response.status !== 200) {
    throw new Error(`${pathname} returned ${response.status}, expected 200`);
  }
  const headers = headersToRecord(response.headers);
  assertClean([...cspFindings(headers), ...staticHeaderFindings(headers), ...hstsFindings(headers)], pathname);
}

async function collectSitemapUrls() {
  const indexResponse = await fetchChecked(`${origin}/sitemap-index.xml`);
  if (indexResponse.status !== 200) {
    throw new Error(`live sitemap index returned ${indexResponse.status}`);
  }
  const sitemapUrls = [...(await indexResponse.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1]);
  const publicUrls = [];

  for (const sitemapUrl of sitemapUrls) {
    const response = await fetchChecked(sitemapUrl);
    if (response.status !== 200) {
      throw new Error(`${sitemapUrl} returned ${response.status}`);
    }
    publicUrls.push(
      ...[...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map((match) => match[1]),
    );
  }

  if (publicUrls.length === 0) throw new Error('live sitemap lists zero URLs');
  return publicUrls;
}

async function verifyLiveRoutes(publicUrls) {
  const failures = [];
  for (let index = 0; index < publicUrls.length; index += 8) {
    const batch = publicUrls.slice(index, index + 8);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const response = await fetchChecked(url, { method: 'HEAD' });
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
export async function verifyNonce() {
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
export async function verifyCacheRules() {
  const home = await fetchChecked(`${origin}/`);
  const html = await home.text();
  const fingerprinted = html.match(/(?:src|href)="(\/_astro\/[^"]+)"/)?.[1];
  const chrome = html.match(/href="(\/assets\/icons\/[^"]+)"/)?.[1];
  if (!fingerprinted || !chrome) throw new Error('/ references no _astro asset or no icon to check cache rules on');

  for (const [pathname, immutable] of [[fingerprinted, true], [chrome, false]]) {
    const response = await fetchChecked(`${origin}${pathname}`, { method: 'HEAD' });
    if (response.status !== 200) throw new Error(`${pathname} returned ${response.status}, expected 200`);
    assertClean(cacheRuleFindings(headersToRecord(response.headers), { immutable }), pathname);
  }
  return `${fingerprinted} is immutable for a year; ${chrome} revalidates hourly`;
}

export async function verifyNotFound() {
  const probe = `/deploy-verify-${Date.now().toString(36)}`;
  const response = await fetchChecked(`${origin}${probe}`);
  if (response.status !== 404) {
    throw new Error(`${probe} returned ${response.status}, expected 404`);
  }
  return 'unknown route returns a real 404';
}

// A well-formed submission with no Turnstile token must be refused before the
// honeypot, the Turnstile call, and the D1 write, so this probe stores nothing.
export async function verifyContactGate() {
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
  const payload = await response.json().catch(() => ({}));
  assertClean(contactRefusalFindings(response.status, payload), 'POST /api/contact without a Turnstile token');
  return 'POST without a Turnstile token is refused with 400';
}

export async function verifySecurityTxt() {
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

async function verifyProductionGuard() {
  const sitedrift = await fetchChecked(`${origin}/__sitedrift/config.json`);
  if (sitedrift.status !== 404) {
    throw new Error(`production sitedrift route returned ${sitedrift.status}, expected 404`);
  }
  return 'sitedrift route is absent';
}

function verifyCodeScanning() {
  const alerts = openCodeScanningAlerts(repository);
  if (alerts.length > 0) {
    throw new Error(`${alerts.length} open code-scanning alert(s) remain`);
  }
  return 'zero open code-scanning alerts';
}

async function run(name, check) {
  try {
    const detail = await check();
    results.push({ name, ok: true, detail });
    status(name, detail);
    return true;
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
    status(name, `FAILED: ${error.message}`);
    annotate('error', `deploy-verify: ${name}`, error.message);
    return false;
  }
}

function skip(name, reason) {
  results.push({ name, ok: null, detail: reason });
  status(name, `skipped: ${reason}`);
}

function writeSummary(sha) {
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

async function main() {
  if (git('status', '--porcelain')) {
    throw new Error('worktree is not clean; commit the verified release candidate first');
  }
  if (git('branch', '--show-current') !== 'main') {
    throw new Error('production deployment verification must run from main');
  }

  const sha = git('rev-parse', 'HEAD');
  const remote = git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0];
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
  let publicUrls = [];
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nfailed: ${error.message}`);
    process.exit(1);
  });
}
