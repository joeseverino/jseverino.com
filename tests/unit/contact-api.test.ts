// Unit tests for the contact endpoint (functions/api/contact.ts): request in,
// response out, with D1 and the Turnstile siteverify call stubbed. This is the
// only place the validation ladder, honeypot, rate limit, and D1 failure paths
// run before production — the Playwright contact spec mocks this API away.
//
//   npm run test:unit

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../../functions/api/contact.ts';
import { createD1Stub } from './helpers/d1-stub.ts';
import { CONTACT_RUNTIME } from '../../functions/lib/contact-contract.ts';

const realFetch = globalThis.fetch;
let turnstile: 'pass' | 'fail' | 'error';
let turnstileCalls: FormData[];

beforeEach(() => {
  turnstile = 'pass';
  turnstileCalls = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    turnstileCalls.push(init?.body as FormData);
    if (turnstile === 'error') throw new Error('network down');
    return new Response(JSON.stringify({ success: turnstile === 'pass' }));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const validPayload = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  message: 'Hello from the unit suite.',
  turnstileToken: 'tok-1',
  sourceUrl: 'https://jseverino.com/contact/',
};

function contactRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://jseverino.com/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function call(request: Request, db = createD1Stub()) {
  const env = { DB: db, TURNSTILE_SECRET_KEY: 'secret-key' };
  return onRequestPost({ request, env } as Parameters<typeof onRequestPost>[0]);
}

describe('request validation', () => {
  test('rejects non-JSON content types with 415', async () => {
    const response = await call(contactRequest('x=1', { 'Content-Type': 'application/x-www-form-urlencoded' }));
    assert.equal(response.status, 415);
  });

  test('matches the media type exactly while accepting parameters and case differences', async () => {
    for (const contentType of ['application/jsonp', 'text/plain; note=application/json']) {
      assert.equal((await call(contactRequest(validPayload, { 'Content-Type': contentType }))).status, 415);
    }
    assert.equal((await call(contactRequest(validPayload, { 'Content-Type': 'Application/JSON; charset=utf-8' }))).status, 200);
  });

  test('rejects an oversized body with 413', async () => {
    const response = await call(contactRequest({ ...validPayload, message: 'x'.repeat(9_000) }));
    assert.equal(response.status, 413);
  });

  test('rejects malformed JSON with 400', async () => {
    const response = await call(contactRequest('{not json'));
    assert.equal(response.status, 400);
  });

  test('rejects missing required fields with 400', async () => {
    const response = await call(contactRequest({ ...validPayload, message: '' }));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /name, email, and message/);
  });

  test('rejects over-length fields with 400', async () => {
    const response = await call(contactRequest({ ...validPayload, name: 'n'.repeat(191) }));
    assert.equal(response.status, 400);
  });

  test('rejects an invalid email with 400', async () => {
    const response = await call(contactRequest({ ...validPayload, email: 'not-an-email' }));
    assert.equal(response.status, 400);
  });

  test('rejects unknown fields because the request contract is closed', async () => {
    const response = await call(contactRequest({ ...validPayload, unexpected: 'value' }));
    assert.equal(response.status, 400);
  });

  test('rejects inherited Object property names as unknown fields', async () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      const response = await call(contactRequest({ ...validPayload, [name]: 'unexpected' }));
      assert.equal(response.status, 400, name);
    }
    assert.equal(turnstileCalls.length, 0);
  });

  test('enforces the body limit in UTF-8 bytes, not string length', async () => {
    const db = createD1Stub();
    const response = await call(contactRequest({ ...validPayload, message: '€'.repeat(3_000) }), db);
    assert.equal(response.status, 413);
    assert.equal(db.queries.length, 0);
    assert.equal(turnstileCalls.length, 0);
  });

  test('rejects non-http source URLs', async () => {
    const response = await call(contactRequest({ ...validPayload, sourceUrl: 'file:///etc/passwd' }));
    assert.equal(response.status, 400);
  });

  test('rejects a missing turnstile token with 400', async () => {
    const response = await call(contactRequest({ ...validPayload, turnstileToken: '' }));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /verification challenge/);
  });
});

describe('honeypot', () => {
  test('pretends success and stores nothing when the hidden field is filled', async () => {
    const db = createD1Stub();
    const response = await call(contactRequest({ ...validPayload, company: 'Bots Inc' }), db);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(db.queries.length, 0);
    assert.equal(turnstileCalls.length, 0);
  });
});

describe('turnstile verification', () => {
  test('fails closed on an HTTP error even if its JSON claims success', async () => {
    globalThis.fetch = async () => Response.json({ success: true }, { status: 503 });
    const db = createD1Stub();
    const response = await call(contactRequest(validPayload), db);
    assert.equal(response.status, 400);
    assert.equal(db.queries.length, 0);
  });

  test('bounds verification through response-body consumption', async (t) => {
    const abort = new AbortController();
    t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
      assert.equal(milliseconds, CONTACT_RUNTIME.turnstileTimeoutMs);
      return abort.signal;
    });
    let cancelled = false;
    globalThis.fetch = async (_input, init) => {
      const signal = init?.signal;
      assert.ok(signal);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"success":'));
          signal.addEventListener('abort', () => {
            cancelled = true;
            controller.error(signal.reason);
          }, { once: true });
          queueMicrotask(() => abort.abort(new DOMException('Timeout', 'TimeoutError')));
        },
      }));
    };
    const db = createD1Stub();
    const response = await call(contactRequest(validPayload), db);
    assert.equal(response.status, 400);
    assert.equal(cancelled, true);
    assert.equal(db.queries.length, 0);
  });

  test('sends secret, token, and caller IP to siteverify', async () => {
    await call(contactRequest(validPayload, { 'CF-Connecting-IP': '203.0.113.7' }));
    assert.equal(turnstileCalls.length, 1);
    assert.equal(turnstileCalls[0].get('secret'), 'secret-key');
    assert.equal(turnstileCalls[0].get('response'), 'tok-1');
    assert.equal(turnstileCalls[0].get('remoteip'), '203.0.113.7');
  });

  test('rejects when siteverify says no', async () => {
    turnstile = 'fail';
    const response = await call(contactRequest(validPayload));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /Verification failed/);
  });

  test('rejects when siteverify is unreachable', async () => {
    turnstile = 'error';
    const response = await call(contactRequest(validPayload));
    assert.equal(response.status, 400);
  });
});

describe('rate limiting', () => {
  test('returns a controlled failure and never inserts when the rate-limit query fails', async () => {
    const db = createD1Stub({ failFirst: true });
    const response = await call(contactRequest(validPayload, { 'CF-Connecting-IP': '203.0.113.7' }), db);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { ok: false, error: 'Could not save your message. Please try again.' });
    assert.equal(db.queries.length, 1);
    assert.match(db.queries[0].query, /SELECT COUNT/);
  });
  test('returns 429 once an IP hits the hourly cap', async () => {
    const db = createD1Stub({ firstResult: { n: 5 } });
    const response = await call(contactRequest(validPayload, { 'CF-Connecting-IP': '203.0.113.7' }), db);
    assert.equal(response.status, 429);
    assert.equal(db.queries.length, 1);
    assert.match(db.queries[0].query, /SELECT COUNT/);
  });

  test('skips the rate-limit query when no client IP is present', async () => {
    const db = createD1Stub();
    await call(contactRequest(validPayload), db);
    assert.equal(db.queries.length, 1);
    assert.match(db.queries[0].query, /INSERT INTO contact_submissions/);
  });
});

describe('persistence', () => {
  test('stores the normalized submission with parsed browser and device', async () => {
    const db = createD1Stub();
    const response = await call(
      contactRequest(validPayload, {
        'CF-Connecting-IP': '203.0.113.7',
        'CF-IPCountry': 'US',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0 Safari/537.36',
      }),
      db,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });

    const insert = db.queries.at(-1);
    assert.ok(insert);
    assert.match(insert.query, /INSERT INTO contact_submissions/);
    const [name, email, message, ip, , browser, device, country, sourceUrl] = insert.values;
    assert.equal(name, 'Jane Doe');
    assert.equal(email, 'jane@example.com');
    assert.equal(message, 'Hello from the unit suite.');
    assert.equal(ip, '203.0.113.7');
    assert.equal(browser, 'Chrome');
    assert.equal(device, 'Mac');
    assert.equal(country, 'US');
    assert.equal(sourceUrl, 'https://jseverino.com/contact/');
  });

  test('returns 500 when the D1 insert fails', async () => {
    const db = createD1Stub({ failRun: true });
    const response = await call(contactRequest(validPayload), db);
    assert.equal(response.status, 500);
  });
});
