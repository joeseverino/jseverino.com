// Unit tests for the Pages middleware (functions/_middleware.ts): per-request
// CSP nonce generation, header rewriting, and the pass-through rules for
// non-HTML and bodyless responses. HTMLRewriter is a Cloudflare runtime
// global, so a recording stub stands in for it; the nonce handler is driven
// directly through the stub's captured registration.
//
//   npm run test:unit

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

interface CapturedHandler {
  selector: string;
  handler: { element(element: { setAttribute(name: string, value: string): void }): void };
}

let lastRewriter: { handlers: CapturedHandler[] } | null = null;

class HTMLRewriterStub {
  handlers: CapturedHandler[] = [];

  on(selector: string, handler: CapturedHandler['handler']) {
    this.handlers.push({ selector, handler });
    return this;
  }

  transform(response: Response) {
    lastRewriter = this;
    return response;
  }
}

(globalThis as Record<string, unknown>).HTMLRewriter = HTMLRewriterStub;

const { onRequest } = await import('../../functions/_middleware.ts');

beforeEach(() => {
  lastRewriter = null;
});

function htmlResponse(extraHeaders: Record<string, string> = {}) {
  return new Response('<html><head><script src="/a.js"></script></head></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders },
  });
}

function call(response: Response) {
  return onRequest({ next: async () => response });
}

function nonceFrom(response: Response): string {
  const match = (response.headers.get('Content-Security-Policy') ?? '').match(/'nonce-([^']+)'/);
  assert.ok(match, 'CSP header carries a nonce');
  return match[1];
}

describe('pass-through rules', () => {
  test('leaves non-HTML responses untouched', async () => {
    const original = new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    const response = await call(original);
    assert.equal(response, original);
    assert.equal(response.headers.get('Content-Security-Policy'), null);
  });

  test('leaves bodyless 304 responses untouched', async () => {
    const original = new Response(null, { status: 304, headers: { 'Content-Type': 'text/html' } });
    const response = await call(original);
    assert.equal(response, original);
  });
});

describe('HTML responses', () => {
  test('sets the enforced CSP, report-only policy, and reporting endpoints', async () => {
    const response = await call(htmlResponse());
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self' 'nonce-/);
    assert.match(csp, /report-uri https:\/\/jseverino\.com\/api\/csp-report/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.match(response.headers.get('Content-Security-Policy-Report-Only') ?? '', /require-trusted-types-for 'script'/);
    assert.equal(
      response.headers.get('Reporting-Endpoints'),
      'csp-endpoint="https://jseverino.com/api/csp-report"',
    );
  });

  test('drops stale encoding headers after the rewrite decompresses the body', async () => {
    const response = await call(htmlResponse({ 'Content-Encoding': 'br', 'Content-Length': '1234' }));
    assert.equal(response.headers.get('Content-Encoding'), null);
    assert.equal(response.headers.get('Content-Length'), null);
  });

  test('generates a fresh nonce per request', async () => {
    const first = nonceFrom(await call(htmlResponse()));
    const second = nonceFrom(await call(htmlResponse()));
    assert.match(first, /^[A-Za-z0-9+/]{22}==$/);
    assert.notEqual(first, second);
  });

  test('applies the same nonce from the CSP header to every script element', async () => {
    const response = await call(htmlResponse());
    const nonce = nonceFrom(response);

    assert.ok(lastRewriter, 'middleware ran the rewriter');
    assert.equal(lastRewriter.handlers.length, 1);
    assert.equal(lastRewriter.handlers[0].selector, 'script');

    const attributes = new Map<string, string>();
    lastRewriter.handlers[0].handler.element({
      setAttribute: (name, value) => attributes.set(name, value),
    });
    assert.equal(attributes.get('nonce'), nonce);
  });
});
