import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { buildOutDir } from '../../src/lib/build-output.mjs';

// Every assertion here is against the Cloudflare runtime serving the built
// output (see playwright.edge.config.ts). The expectations mirror what
// public/_headers and functions/_middleware.ts promise, and what
// bin/deploy-verify.mjs probes on production after a release.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, buildOutDir());

const nonceIn = (csp: string | null) => /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp ?? '')?.[1] ?? null;

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

    const csp = headers['content-security-policy'] ?? '';
    expect(nonceIn(csp), 'script nonce in the CSP').not.toBeNull();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain('report-to csp-endpoint');
    expect(csp).toContain('report-uri https://jseverino.com/api/csp-report');
    expect(csp, 'script-src must not fall back to unsafe-inline').not.toMatch(/script-src[^;]*'unsafe-inline'/);

    expect(headers['content-security-policy-report-only'] ?? '').toContain("require-trusted-types-for 'script'");
    expect(headers['reporting-endpoints'] ?? '').toContain('/api/csp-report');

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['x-permitted-cross-domain-policies']).toBe('none');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-resource-policy']).toBe('same-site');
    expect(headers['permissions-policy'] ?? '').toContain('camera=()');
    expect(headers['access-control-allow-origin'], 'no CORS header on HTML').toBeUndefined();
  });

  test(`${pathname} stamps the header nonce on every script tag`, async ({ request }) => {
    const response = await request.get(pathname);
    const nonce = nonceIn(response.headers()['content-security-policy'] ?? '');
    expect(nonce).not.toBeNull();

    const html = await response.text();
    const scripts = html.match(/<script\b/g)?.length ?? 0;
    const stamped = html.split(`nonce="${nonce}"`).length - 1;
    expect(scripts, 'the page renders at least one script tag').toBeGreaterThan(0);
    expect(stamped, 'every script tag carries the header nonce').toBe(scripts);
  });
}

test('the nonce rotates between requests', async ({ request }) => {
  const first = nonceIn((await request.get('/')).headers()['content-security-policy'] ?? '');
  const second = nonceIn((await request.get('/')).headers()['content-security-policy'] ?? '');
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first).not.toBe(second);
});

test('fingerprinted assets are immutable for a year and chrome assets are not', async ({ request }) => {
  const fingerprinted = await request.get(firstFile('_astro', (name) => /\.(css|js)$/.test(name)));
  expect(fingerprinted.status()).toBe(200);
  expect(fingerprinted.headers()['cache-control']).toContain('max-age=31536000');
  expect(fingerprinted.headers()['cache-control']).toContain('immutable');
  expect(fingerprinted.headers()['access-control-allow-origin']).toBeUndefined();

  const icon = await request.get(firstFile('assets/icons', (name) => !name.startsWith('.')));
  expect(icon.status()).toBe(200);
  expect(icon.headers()['cache-control']).toContain('max-age=3600');
  expect(icon.headers()['cache-control']).toContain('must-revalidate');
  expect(icon.headers()['cache-control'], 'a stale logo must never be pinned for a year').not.toContain('immutable');
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
    sourceUrl: 'https://jseverino.com/contact/',
  };

  test('refuses a submission without a Turnstile token before any external call', async ({ request }) => {
    const response = await request.post('/api/contact', { data: valid });
    expect(response.status()).toBe(400);
    const payload = await response.json();
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/verification/i);
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
  const committed = fs.readFileSync(path.join(root, 'public/.well-known/security.txt'), 'utf8');
  expect(await response.text()).toBe(committed);
});

test('the WKD key is served as a binary octet stream', async ({ request }) => {
  const key = firstFile('.well-known/openpgpkey/hu', (name) => !name.startsWith('.'));
  const response = await request.get(key);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/octet-stream');
});
