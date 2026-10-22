import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { buildOutDir } from '../../src/lib/build-output.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { SITE_ORIGIN, writeupPath } from '../../src/lib/site-config.ts';
import {
  cacheRuleFindings,
  contactRefusalFindings,
  cspFindings,
  inlineHashFindings,
  staticHeaderFindings,
} from '../../src/lib/edge-expectations.ts';

// Every assertion here is against the Cloudflare runtime serving the built
// output (see tests/playwright.edge.config.ts). The expectations are the functions
// in src/lib/edge-expectations.ts, which bin/deploy-verify.ts asserts
// against production after a release; a finding list is empty when correct.

const dist = path.join(siteRoot, buildOutDir);

function firstFile(dir: string, matches: (name: string) => boolean): string {
  const hit = fs.readdirSync(path.join(dist, dir)).find(matches);
  if (!hit) throw new Error(`the build has no matching file under ${dir}/`);
  return `/${dir}/${hit}`;
}

function firstWriteup(): string {
  const slug = fs
    .readdirSync(path.join(dist, 'portfolio'), { withFileTypes: true })
    .find((entry) => entry.isDirectory() && fs.existsSync(path.join(dist, 'portfolio', entry.name, 'index.html')));
  if (!slug) throw new Error('the build has no /portfolio/<slug>/ page');
  return writeupPath(slug.name);
}

const htmlPaths = ['/', '/contact/', firstWriteup()];

for (const pathname of htmlPaths) {
  test(`${pathname} carries the CSP and the static security headers`, async ({ request }) => {
    const response = await request.get(pathname);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(cspFindings(headers, pathname)).toEqual([]);
    expect(staticHeaderFindings(headers)).toEqual([]);
  });

  test(`${pathname} carries the hash of every inline script and style in its policy`, async ({ request }) => {
    const response = await request.get(pathname);
    expect(await inlineHashFindings(await response.text(), response.headers()['content-security-policy'])).toEqual([]);
  });
}

test('the policy is the same on every request: nothing is computed per view', async ({ request }) => {
  const first = (await request.get('/')).headers()['content-security-policy'];
  const second = (await request.get('/')).headers()['content-security-policy'];
  expect(first).toBeTruthy();
  expect(first).toBe(second);
});

test('the contact page enforces everything but Trusted Types, which it only reports', async ({ request }) => {
  const contact = (await request.get('/contact/')).headers();
  const home = (await request.get('/')).headers();
  expect(contact['content-security-policy']).not.toContain('require-trusted-types-for');
  expect(contact['content-security-policy-report-only']).toContain("require-trusted-types-for 'script'");
  expect(home['content-security-policy']).toContain("require-trusted-types-for 'script'");
  expect(home['content-security-policy-report-only']).toBeUndefined();
  const withoutTrustedTypes = (policy = '') => policy.replace(/ ?require-trusted-types-for 'script';?/, '');
  expect(withoutTrustedTypes(contact['content-security-policy'])).toBe(withoutTrustedTypes(home['content-security-policy']));
});

test('fingerprinted and chrome assets carry the cache rules public/_headers gives them', async ({ request }) => {
  for (const pathname of [firstFile('_astro', (name) => /\.(css|js)$/.test(name)), firstFile('assets/icons', (name) => !name.startsWith('.'))]) {
    const response = await request.get(pathname);
    expect(response.status()).toBe(200);
    expect(cacheRuleFindings(response.headers(), pathname)).toEqual([]);
  }
});

test('an unknown route returns a real 404', async ({ request }) => {
  const response = await request.get(`/edge-probe-${Date.now().toString(36)}`);
  expect(response.status()).toBe(404);
  expect(response.headers()['content-type'] ?? '').toContain('text/html');
});

// Only `run_worker_first` in wrangler.jsonc starts the Worker, so every page
// and asset is served from static assets, with the policy and security headers
// from public/_headers.
test.describe('static serving', () => {
  const probe = Date.now().toString(36);

  test('a missing page is a static 404 with the policy', async ({ request }) => {
    const response = await request.get(`/edge-probe-${probe}/`);
    expect(response.status()).toBe(404);
    expect(cspFindings(response.headers())).toEqual([]);
    expect(await inlineHashFindings(await response.text(), response.headers()['content-security-policy'])).toEqual([]);
  });

  test('an asset keeps its cache rule and the security headers', async ({ request }) => {
    const pathname = firstFile('assets/icons', (name) => !name.startsWith('.'));
    const icon = await request.get(pathname);
    expect(icon.status()).toBe(200);
    expect(cacheRuleFindings(icon.headers(), pathname)).toEqual([]);
    expect(staticHeaderFindings(icon.headers()).filter((finding) => !finding.startsWith('access-control'))).toEqual([]);
  });

  for (const prefix of ['assets', '_astro', '.well-known']) {
    test(`a miss under /${prefix}/ is a static 404 with the policy`, async ({ request }) => {
      const miss = await request.get(`/${prefix}/edge-probe-${probe}/x.png`);
      expect(miss.status()).toBe(404);
      expect(cspFindings(miss.headers())).toEqual([]);
    });
  }
});

test('a page path without its slash redirects to the slashed page', async ({ request }) => {
  const response = await request.get('/about', { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()['location']).toBe('/about/');
});

test('the preview review proxy is absent from a production build', async ({ request }) => {
  const response = await request.get('/__sitedrift/config.json');
  expect(response.status()).toBe(404);
});

test.describe('POST /api/contact', () => {
  const valid = {
    name: 'edge suite',
    email: 'edge-suite@example.com',
    message: 'Automated pre-deploy probe. No verification token supplied.',
    sourceUrl: `${SITE_ORIGIN}/contact/`,
  };

  test('refuses a submission without a Turnstile token before any external call', async ({ request }) => {
    const response = await request.post('/api/contact', { data: valid });
    expect(contactRefusalFindings(response.status(), await response.json())).toEqual([]);
  });

  test('answers at its own path, with the security headers the assets layer gives a page', async ({ request }) => {
    const response = await request.post('/api/contact', { data: valid, maxRedirects: 0 });
    expect(response.status()).toBe(400);
    expect(staticHeaderFindings(response.headers())).toEqual([]);
    expect(response.headers()['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers()['cache-control']).toBe('no-store');
  });

  test('refuses a body that is not JSON', async ({ request }) => {
    const response = await request.post('/api/contact', {
      headers: { 'Content-Type': 'text/plain' },
      data: 'name=edge',
    });
    expect(response.status()).toBe(415);
  });

  test('refuses malformed JSON', async ({ request }) => {
    const response = await request.post('/api/contact', {
      headers: { 'Content-Type': 'application/json' },
      data: '{"name":',
    });
    expect(response.status()).toBe(400);
  });

  test('refuses fields outside the contract', async ({ request }) => {
    const response = await request.post('/api/contact', { data: { ...valid, turnstileToken: 'x', admin: true } });
    expect(response.status()).toBe(400);
  });
});

test('security.txt is served byte-for-byte from the committed, signed file', async ({ request }) => {
  const response = await request.get('/.well-known/security.txt');
  expect(response.status()).toBe(200);
  const committed = fs.readFileSync(path.join(siteRoot, 'public/.well-known/security.txt'), 'utf8');
  expect(await response.text()).toBe(committed);
});

test('the WKD key is served as a binary octet stream', async ({ request }) => {
  const key = firstFile('.well-known/openpgpkey/hu', (name) => !name.startsWith('.'));
  const response = await request.get(key);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/octet-stream');
});
