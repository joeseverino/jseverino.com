// The Content Security Policy builder and the inline-markup scan
// (functions/lib/csp.ts): what the policy allows, which tags get hashed, and
// which markup is a build failure.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CSP_INLINE_MARKER, htmlPolicy, hashSource, inlineHashes, scanInline, trustedTypesReportOnly, withPreviewPolicy } from '../../functions/lib/csp.ts';

const reportUri = 'https://example.test/api/csp-report';
const marked = `nonce="${CSP_INLINE_MARKER}"`;

describe('hashSource', () => {
  test('is the base64 SHA-256 of the text', async () => {
    assert.equal(await hashSource('abc'), 'sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  });
});

describe('htmlPolicy', () => {
  const policy = htmlPolicy({ scriptHashes: ['sha256-AAA'], styleHashes: ['sha256-BBB'], reportUri, trustedTypes: true });

  test('lists hashes and named hosts, with no nonce or escape hatch', () => {
    assert.match(policy, /script-src 'self' 'sha256-AAA' https:\/\/challenges\.cloudflare\.com https:\/\/static\.cloudflareinsights\.com(;|$)/);
    assert.match(policy, /style-src 'self' 'sha256-BBB'(;|$)/);
    assert.match(policy, /^default-src 'none'; /);
    assert.doesNotMatch(policy, /unsafe-|strict-dynamic|nonce-|blob:/);
  });

  test('enforces Trusted Types unless the page opts out', () => {
    assert.match(policy, /require-trusted-types-for 'script'/);
    assert.doesNotMatch(htmlPolicy({ scriptHashes: [], styleHashes: [], reportUri, trustedTypes: false }), /require-trusted-types-for/);
    assert.match(trustedTypesReportOnly(reportUri), /^require-trusted-types-for 'script'; report-to csp-endpoint; report-uri /);
  });

  test('reports to the endpoint both ways', () => {
    assert.match(policy, /report-to csp-endpoint; report-uri https:\/\/example\.test\/api\/csp-report$/);
  });

  test('takes extra script sources for the preview proxy', () => {
    assert.match(htmlPolicy({ scriptHashes: [], styleHashes: [], reportUri, trustedTypes: false, scriptExtras: ["'nonce-xyz'"] }), /script-src 'self' 'nonce-xyz' https:/);
  });
});

describe('scanInline', () => {
  test('hashes a marked inline script and the head stylesheet, and removes the marker', async () => {
    const html = `<html><head><script ${marked}>go()</script><style>p{}</style></head><body></body></html>`;
    const scan = await scanInline(html);
    assert.deepEqual(scan.problems, []);
    assert.deepEqual(scan.scriptHashes, [await hashSource('go()')]);
    assert.deepEqual(scan.styleHashes, [await hashSource('p{}')]);
    assert.ok(!scan.html.includes(CSP_INLINE_MARKER));
    assert.ok(scan.html.includes('<script>go()</script>'));
  });

  test('allows same-origin and named-host scripts, and data blocks', async () => {
    const html = `<head><script type="module" src="/_astro/a.js"></script><script async src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script><script type="application/ld+json">{"a":1}</script></head>`;
    assert.deepEqual((await scanInline(html)).problems, []);
  });

  test('flags an unmarked inline script, a foreign script, and a body style', async () => {
    const html = `<head><script>evil()</script><script src="https://evil.example/x.js"></script></head><body><style>p{}</style></body>`;
    const { problems } = await scanInline(html);
    assert.equal(problems.length, 3);
    assert.match(problems[0] ?? '', /inline script the site did not mark/);
    assert.match(problems[1] ?? '', /source the policy does not allow/);
    assert.match(problems[2] ?? '', /inline style the site did not emit/);
  });

  test('accepts a marked style in the body, as the preview viewer writes it', async () => {
    const scan = await scanInline(`<head></head><body><style ${marked}>b{}</style></body>`);
    assert.deepEqual(scan.problems, []);
    assert.equal(scan.styleHashes.length, 1);
  });

  test('a protocol-relative script is not same-origin', async () => {
    assert.equal((await scanInline('<head><script src="//evil.example/x.js"></script></head>')).problems.length, 1);
  });

  test('an identical script on many pages is one hash', async () => {
    const page = `<head><script ${marked}>go()</script></head>`;
    assert.equal(new Set([...(await scanInline(page)).scriptHashes, ...(await scanInline(page)).scriptHashes]).size, 1);
  });
});

describe('inlineHashes', () => {
  test('hashes every inline script and style of fetched markup, ignoring external and data tags', async () => {
    const html = `<style>a{}</style><script>one()</script><script src="/x.js"></script><script type="application/ld+json">{}</script>`;
    const { scriptHashes, styleHashes } = await inlineHashes(html);
    assert.deepEqual(scriptHashes, [await hashSource('one()')]);
    assert.deepEqual(styleHashes, [await hashSource('a{}')]);
  });
});

describe('withPreviewPolicy', () => {
  const html = (init: ResponseInit = {}) =>
    new Response('<head><script>bridge()</script><style>a{}</style></head>', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': '99' }, ...init });

  test('gives HTML its own policy: the bridge nonce plus a hash per inline tag', async () => {
    const response = await withPreviewPolicy(html(), 'abc123', reportUri);
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    assert.match(csp, /script-src 'self' 'sha256-[^']+' 'nonce-abc123' https:/);
    assert.ok(csp.includes(`'${await hashSource('bridge()')}'`));
    assert.ok(csp.includes(`'${await hashSource('a{}')}'`));
    assert.doesNotMatch(csp, /require-trusted-types-for/);
    assert.equal(response.headers.get('Content-Length'), null);
    assert.match(await response.text(), /bridge\(\)/);
  });

  test('keeps status and other headers', async () => {
    const response = await withPreviewPolicy(html({ status: 404, statusText: 'Not Found' }), 'n', reportUri);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('Content-Type') ?? '', /text\/html/);
  });

  test('passes non-HTML and bodyless responses through untouched', async () => {
    const css = new Response('a{}', { headers: { 'Content-Type': 'text/css' } });
    assert.equal(await withPreviewPolicy(css, 'n', reportUri), css);
    const head = new Response(null, { headers: { 'Content-Type': 'text/html' } });
    assert.equal(await withPreviewPolicy(head, 'n', reportUri), head);
  });
});
