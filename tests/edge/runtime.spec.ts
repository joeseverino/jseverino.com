import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { buildOutDir } from '../../src/lib/build-output.mjs';
import { siteRoot } from '../../src/lib/site-root.mjs';
import {
  cacheRuleFindings,
  contactRefusalFindings,
  cspFindings,
  nonceFromCsp,
  nonceParityFindings,
  siteOrigin,
  staticHeaderFindings,
} from '../../src/lib/edge-expectations.mjs';

// Every assertion here is against the Cloudflare runtime serving the built
// output (see playwright.edge.config.ts). The expectations are the functions
// in src/lib/edge-expectations.mjs, which bin/deploy-verify.mjs asserts
// against production after a release; a finding list is empty when correct.

const dist = path.join(siteRoot, buildOutDir());

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
  return `/portfolio/${slug.name}/`;
}

const htmlPaths = ['/', firstWriteup()];

for (const pathname of htmlPaths) {
  test(`${pathname} carries the per-request CSP and the static security headers`, async ({ request }) => {
    const response = await request.get(pathname);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(cspFindings(headers)).toEqual([]);
    expect(staticHeaderFindings(headers)).toEqual([]);
  });

  test(`${pathname} stamps the header nonce on every script tag`, async ({ request }) => {
    const response = await request.get(pathname);
    const nonce = nonceFromCsp(response.headers()['content-security-policy']);
    expect(nonce).not.toBeNull();
    expect(nonceParityFindings(await response.text(), nonce)).toEqual([]);
  });
}

test('the nonce rotates between requests', async ({ request }) => {
  const first = nonceFromCsp((await request.get('/')).headers()['content-security-policy']);
  const second = nonceFromCsp((await request.get('/')).headers()['content-security-policy']);
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first).not.toBe(second);
});

test('fingerprinted assets are immutable for a year and chrome assets are not', async ({ request }) => {
  const fingerprinted = await request.get(firstFile('_astro', (name) => /\.(css|js)$/.test(name)));
  expect(fingerprinted.status()).toBe(200);
  expect(cacheRuleFindings(fingerprinted.headers(), { immutable: true })).toEqual([]);

  const icon = await request.get(firstFile('assets/icons', (name) => !name.startsWith('.')));
  expect(icon.status()).toBe(200);
  expect(cacheRuleFindings(icon.headers(), { immutable: false })).toEqual([]);
});

test('an unknown route returns a real 404', async ({ request }) => {
  const response = await request.get(`/edge-probe-${Date.now().toString(36)}`);
  expect(response.status()).toBe(404);
  expect(response.headers()['content-type'] ?? '').toContain('text/html');
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
    sourceUrl: `${siteOrigin}/contact/`,
  };

  test('refuses a submission without a Turnstile token before any external call', async ({ request }) => {
    const response = await request.post('/api/contact', { data: valid });
    expect(contactRefusalFindings(response.status(), await response.json())).toEqual([]);
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
