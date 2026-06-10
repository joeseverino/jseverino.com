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
