// Unit tests for the sitedrift preview proxy (functions/__sitedrift/[[path]].ts):
// inert in production, forwards no credentials, restores the security headers,
// and nonces sitedrift's own frame bridge and nothing it did not inject.
//
//   npm run test:unit

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { frameBridge } from './helpers/sitedrift-internals.ts';
import { CSP_NONCE_ATTRIBUTE } from '../../functions/lib/csp-nonce.ts';
import { stampBridge } from '../../functions/lib/sitedrift-preview.ts';

const rewrites: string[] = [];
(globalThis as Record<string, unknown>).HTMLRewriter = class {
  on(selector: string) {
    rewrites.push(selector);
    return this;
  }
  transform(response: Response) {
    return response;
  }
};

const { onRequest } = await import('../../functions/__sitedrift/[[path]].ts');

const PREVIEW = 'https://feature.jseverino-com.pages.dev';
const config = JSON.stringify({ live: 'https://jseverino.com' });
const page = `<!doctype html><html><head><title>t</title><style ${CSP_NONCE_ATTRIBUTE}>p{}</style></head><body><p>x</p></body></html>`;

function assets(files: Record<string, string>) {
  return {
    async fetch(input: Request | URL | string) {
      const { pathname } = new URL(input instanceof Request ? input.url : input);
      const body = files[pathname];
      return body === undefined
        ? new Response('missing', { status: 404 })
        : new Response(body, { headers: { 'Content-Type': pathname.endsWith('.json') ? 'application/json' : 'text/plain' } });
    },
  };
}

function call(url: string, files: Record<string, string>, headers: Record<string, string> = {}) {
  return onRequest({
    request: new Request(url, { headers: { Accept: 'text/html', ...headers } }),
    env: { ASSETS: assets(files) },
    next: async () => new Response('next'),
  });
}

const realFetch = globalThis.fetch;
let upstream: Request[];

beforeEach(() => {
  upstream = [];
  rewrites.length = 0;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    upstream.push(new Request(input, init));
    return new Response(page, { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'" } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('production', () => {
  test('the production host never answers', async () => {
    const response = await call('https://jseverino.com/__sitedrift/live/', { '/__sitedrift/config.json': config });
    assert.equal(response.status, 404);
    assert.equal(upstream.length, 0);
  });

  test('a build without the sitedrift config returns 404, not 502', async () => {
    for (const path of ['/__sitedrift/live/', '/__sitedrift/dev/', '/__sitedrift/config.json']) {
      const response = await call(`https://jseverino-com.pages.dev${path}`, {});
      assert.equal(response.status, 404, path);
    }
    assert.equal(upstream.length, 0);
  });
});

describe('preview', () => {
  test('forwards no cookies, authorization, or client identity to LIVE', async () => {
    const response = await call(`${PREVIEW}/__sitedrift/live/about/`, { '/__sitedrift/config.json': config }, {
      Cookie: 'CF_Authorization=secret',
      Authorization: 'Bearer secret',
      'Cf-Access-Jwt-Assertion': 'jwt',
      'Accept-Language': 'en-US',
    });
    assert.equal(response.status, 200);
    assert.equal(upstream.length, 1);
    assert.equal(upstream[0]?.url, 'https://jseverino.com/about/');
    assert.equal(upstream[0]?.headers.get('cookie'), null);
    assert.equal(upstream[0]?.headers.get('authorization'), null);
    assert.equal(upstream[0]?.headers.get('cf-access-jwt-assertion'), null);
    assert.equal(upstream[0]?.headers.get('accept-language'), 'en-US');
  });

  test('restores the static security headers', async () => {
    const response = await call(`${PREVIEW}/__sitedrift/live/`, { '/__sitedrift/config.json': config });
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('X-Frame-Options'), 'SAMEORIGIN');
    assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  });

  test('nonces the injected bridge on DEV pages and leaves the rest to the build stamps', async () => {
    const response = await call(`${PREVIEW}/__sitedrift/dev/`, {
      '/__sitedrift/config.json': config,
      '/__sitedrift_source/index.html.txt': page,
    });
    const html = await response.text();
    assert.equal(html.split(CSP_NONCE_ATTRIBUTE).length - 1, 2, 'the page style and the bridge');
    assert.match(html, new RegExp(`<script ${CSP_NONCE_ATTRIBUTE}>\\(\\(\\) => \\{`));
    assert.deepEqual(rewrites, [], 'DEV is not restamped');
  });

  test('restamps only nonce-bearing tags on LIVE pages', async () => {
    await call(`${PREVIEW}/__sitedrift/live/`, { '/__sitedrift/config.json': config });
    assert.deepEqual(rewrites, ['script[nonce]', 'style[nonce]']);
  });
});

describe('stampBridge', () => {
  test('stamps the bridge sitedrift injects before </head>', () => {
    const html = page.replace('</head>', `${frameBridge('dev', '/__sitedrift/dev')}</head>`);
    const stamped = stampBridge(html);
    assert.equal(stamped.split('<script').length - 1, 1);
    assert.ok(stamped.includes(`<script ${CSP_NONCE_ATTRIBUTE}>(() => {`));
  });

  test('stamps the bridge opening a document without a head', () => {
    const stamped = stampBridge(`${frameBridge('live', '/__sitedrift/live')}<p>x</p>`);
    assert.ok(stamped.startsWith(`<script ${CSP_NONCE_ATTRIBUTE}>`));
  });

  test('leaves a page alone when the script before </head> is not a lone bare script', () => {
    for (const html of [
      page,
      '<html><head><script src="/x.js"></script></head></html>',
      '<html><head><script>a()</script><p></head></html>',
    ]) {
      assert.equal(stampBridge(html), html);
    }
  });
});
