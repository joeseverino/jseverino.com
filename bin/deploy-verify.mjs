#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const repository = 'joeseverino/jseverino.com';
const origin = 'https://jseverino.com';
const requiredChecks = new Set([
  'build',
  'e2e',
  'visual',
  'analyze javascript-typescript',
  'Cloudflare Pages',
]);

function command(name, args) {
  const result = spawnSync(name, args, {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${name} ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function status(label, detail) {
  console.log(`${label.padEnd(12)} ${detail}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchChecked(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
    ...options,
  });
  return response;
}

async function waitForChecks(sha) {
  const deadline = Date.now() + 15 * 60_000;

  while (Date.now() < deadline) {
    const payload = JSON.parse(
      command('gh', [
        'api',
        `repos/${repository}/commits/${sha}/check-runs`,
        '--method',
        'GET',
        '-f',
        'per_page=100',
      ]),
    );
    const checks = new Map(payload.check_runs.map((check) => [check.name, check]));
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
      status('remote', `${requiredChecks.size} required checks passed`);
      return;
    }

    status(
      'remote',
      `waiting for checks${missing.length ? `; missing ${missing.join(', ')}` : ''}${pending.length ? `; pending ${pending.join(', ')}` : ''}`,
    );
    await sleep(10_000);
  }

  throw new Error('timed out waiting for required GitHub and Cloudflare checks');
}

function assertHeader(headers, name, predicate, expected) {
  const value = headers.get(name) ?? '';
  if (!predicate(value)) {
    throw new Error(`${name} failed for live origin; expected ${expected}, received ${value || '<missing>'}`);
  }
}

async function verifyHeaders(pathname) {
  const response = await fetchChecked(`${origin}${pathname}`, { method: 'HEAD' });
  if (response.status !== 200) {
    throw new Error(`${pathname} returned ${response.status}, expected 200`);
  }

  assertHeader(
    response.headers,
    'content-security-policy',
    (value) =>
      value.includes('report-to csp-endpoint') &&
      value.includes('report-uri https://jseverino.com/api/csp-report') &&
      !/script-src[^;]*'unsafe-inline'/.test(value),
    'report-to/report-uri and no unsafe-inline in script-src',
  );
  assertHeader(
    response.headers,
    'reporting-endpoints',
    (value) => value.includes('/api/csp-report'),
    '/api/csp-report endpoint',
  );
  assertHeader(
    response.headers,
    'strict-transport-security',
    (value) => /includesubdomains/i.test(value),
    'includeSubDomains',
  );
  assertHeader(
    response.headers,
    'x-content-type-options',
    (value) => value.toLowerCase() === 'nosniff',
    'nosniff',
  );
  assertHeader(
    response.headers,
    'referrer-policy',
    (value) => value.toLowerCase() === 'strict-origin-when-cross-origin',
    'strict-origin-when-cross-origin',
  );
}

async function verifyLiveRoutes() {
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

  const failures = [];
  for (let index = 0; index < publicUrls.length; index += 8) {
    const batch = publicUrls.slice(index, index + 8);
    const results = await Promise.all(
      batch.map(async (url) => {
        const response = await fetchChecked(url, { method: 'HEAD' });
        return { url, status: response.status };
      }),
    );
    failures.push(...results.filter((result) => result.status !== 200));
  }
  if (failures.length > 0) {
    throw new Error(
      `live routes failed: ${failures.map(({ url, status: code }) => `${code} ${url}`).join(', ')}`,
    );
  }
  status('routes', `${publicUrls.length} sitemap URLs returned 200`);
}

async function main() {
  if (command('git', ['status', '--porcelain'])) {
    throw new Error('worktree is not clean; commit the verified release candidate first');
  }
  if (command('git', ['branch', '--show-current']) !== 'main') {
    throw new Error('production deployment verification must run from main');
  }

  const sha = command('git', ['rev-parse', 'HEAD']);
  const remote = command('git', ['ls-remote', 'origin', 'refs/heads/main'])
    .split(/\s+/)[0];
  if (sha !== remote) {
    throw new Error(`local HEAD ${sha} does not match origin/main ${remote}`);
  }
  status('commit', `${sha.slice(0, 12)} is clean and pushed to main`);

  command('npm', ['audit', '--omit=dev', '--audit-level=high']);
  status('audit', 'no high-severity production dependency advisories');

  await waitForChecks(sha);

  await verifyHeaders('/');
  await verifyHeaders('/portfolio/zero-trust-private-infrastructure/');
  status('headers', 'CSP, reporting, HSTS, nosniff, and referrer policy passed');

  const sitedrift = await fetchChecked(`${origin}/__sitedrift/config.json`);
  if (sitedrift.status !== 404) {
    throw new Error(`production sitedrift route returned ${sitedrift.status}, expected 404`);
  }
  status('production', 'sitedrift route is absent');

  await verifyLiveRoutes();

  const alerts = JSON.parse(
    command('gh', [
      'api',
      `repos/${repository}/code-scanning/alerts`,
      '--method',
      'GET',
      '-f',
      'state=open',
      '-f',
      'per_page=100',
    ]),
  );
  if (alerts.length > 0) {
    throw new Error(`${alerts.length} open code-scanning alert(s) remain`);
  }
  status('security', 'zero open code-scanning alerts');

  console.log('\nok deployed: pushed commit, remote checks, production guard, headers, routes, dependency audit, and code scanning passed');
}

main().catch((error) => {
  console.error(`\nfailed: ${error.message}`);
  process.exit(1);
});
