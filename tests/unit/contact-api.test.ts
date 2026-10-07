// Contact endpoint with D1 and Turnstile stubbed. The Playwright contact spec mocks this API away,
// so this is the only pre-production run of the validation ladder, honeypot, rate limit and D1 failures.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../../functions/api/contact.ts';
import { TURNSTILE_TEST_SECRETS, siteverifyAccepts } from '../../functions/lib/turnstile.ts';
import { createD1Stub } from './helpers/d1-stub.ts';
import { createD1Sqlite } from './helpers/d1-sqlite.ts';
import { CONTACT_RUNTIME } from '../../functions/lib/contact-contract.ts';
import { postRequest } from './helpers/requests.ts';

const realFetch = globalThis.fetch;
let turnstile: 'pass' | 'fail' | 'error';
let siteverify: Record<string, unknown>;
let turnstileCalls: FormData[];

beforeEach(() => {
  turnstile = 'pass';
  siteverify = { hostname: 'jseverino.com', action: CONTACT_RUNTIME.turnstileAction };
  turnstileCalls = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    turnstileCalls.push(init?.body as FormData);
    if (turnstile === 'error') throw new Error('network down');
    return new Response(JSON.stringify({ success: turnstile === 'pass', ...siteverify }));
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

const contactRequest = (body: unknown, headers: Record<string, string> = {}): Request =>
  postRequest('https://jseverino.com/api/contact', body, { 'Content-Type': 'application/json', ...headers });

function call(request: Request, db: { prepare: unknown } = createD1Stub()) {
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

  test('stores the source only when it names this site, as a path without query or fragment', async () => {
    const stored = async (sourceUrl: string | undefined, referer?: string) => {
      const db = createD1Stub();
      const payload = sourceUrl === undefined ? { ...validPayload, sourceUrl: undefined } : { ...validPayload, sourceUrl };
      const response = await call(contactRequest(payload, referer ? { Referer: referer } : {}), db);
      assert.equal(response.status, 200);
      return db.queries.at(-1)?.values[8];
    };
    assert.equal(await stored('https://jseverino.com/contact/?utm=x#top'), 'https://jseverino.com/contact/');
    assert.equal(await stored('https://evil.example/phish'), null);
    assert.equal(await stored('https://evil.example/phish', 'https://jseverino.com/about/?a=1'), 'https://jseverino.com/about/');
    assert.equal(await stored(undefined, 'https://evil.example/'), null);
    assert.equal(await stored('https://jseverino.com.evil.example/contact/'), null);
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

async function assertRejectedUnstored(): Promise<void> {
  const db = createD1Stub();
  const response = await call(contactRequest(validPayload), db);
  assert.equal(response.status, 400);
  assert.equal(db.queries.length, 0);
}

describe('turnstile verification', () => {
  test('fails closed on an HTTP error even if its JSON claims success', async () => {
    globalThis.fetch = async () => Response.json({ success: true }, { status: 503 });
    await assertRejectedUnstored();
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

  test('sends secret, token, caller IP, and a fresh idempotency key to siteverify', async () => {
    await call(contactRequest(validPayload, { 'CF-Connecting-IP': '203.0.113.7' }));
    await call(contactRequest(validPayload, { 'CF-Connecting-IP': '203.0.113.7' }));
    assert.equal(turnstileCalls.length, 2);
    assert.equal(turnstileCalls[0]?.get('secret'), 'secret-key');
    assert.equal(turnstileCalls[0]?.get('response'), 'tok-1');
    assert.equal(turnstileCalls[0]?.get('remoteip'), '203.0.113.7');
    const keys = turnstileCalls.map((body) => String(body.get('idempotency_key')));
    assert.match(keys[0] ?? '', /^[0-9a-f-]{36}$/);
    assert.notEqual(keys[0], keys[1]);
  });

  test('rejects a token solved on another hostname', async () => {
    siteverify.hostname = 'evil.example';
    await assertRejectedUnstored();
  });

  test('rejects a token minted for a different widget action', async () => {
    siteverify.action = 'login';
    await assertRejectedUnstored();
  });

  test('rejects a siteverify response that omits hostname and action', async () => {
    siteverify = {};
    const response = await call(contactRequest(validPayload));
    assert.equal(response.status, 400);
  });

  test('the test secret from .env.example accepts siteverify\'s test hostname and action; production does not', () => {
    const test = { success: true, hostname: 'localhost', action: 'test' };
    const [passing] = TURNSTILE_TEST_SECRETS;
    assert.equal(siteverifyAccepts(test, passing ?? ''), true);
    assert.equal(siteverifyAccepts(test, '1x0000000000000000000000000000000AA'), true);
    assert.equal(siteverifyAccepts(test, 'secret-key'), false);
    assert.equal(siteverifyAccepts({ ...test, hostname: 'evil.example' }, '1x0000000000000000000000000000000AA'), false);
    assert.equal(siteverifyAccepts({ ...test, success: false }, '2x0000000000000000000000000000000AA'), false);
    assert.equal(siteverifyAccepts({ success: true, hostname: 'jseverino.com', action: CONTACT_RUNTIME.turnstileAction }, 'secret-key'), true);
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
  test('returns 429 when the capped INSERT writes nothing', async () => {
    const db = createD1Stub({ changes: 0 });
    const response = await call(contactRequest(validPayload, { 'CF-Connecting-IP': '203.0.113.7' }), db);
    assert.equal(response.status, 429);
    assert.equal(db.queries.length, 1);
    assert.match(db.queries[0]?.query ?? '', /INSERT INTO contact_submissions/);
  });

  test('caps an IP at the hourly limit inside one statement', async () => {
    const db = createD1Sqlite();
    const statuses = [];
    for (let i = 0; i <= CONTACT_RUNTIME.maxPerIpPerHour; i += 1) {
      statuses.push((await call(contactRequest(validPayload, { 'CF-Connecting-IP': '203.0.113.7' }), db)).status);
    }
    assert.deepEqual(statuses, [...Array(CONTACT_RUNTIME.maxPerIpPerHour).fill(200), 429]);
    assert.equal(db.count('contact_submissions'), CONTACT_RUNTIME.maxPerIpPerHour);

    const other = await call(contactRequest(validPayload, { 'CF-Connecting-IP': '198.51.100.9' }), db);
    assert.equal(other.status, 200);
  });

  test('does not cap submissions that carry no client IP', async () => {
    const db = createD1Sqlite();
    for (let i = 0; i <= CONTACT_RUNTIME.maxPerIpPerHour; i += 1) {
      assert.equal((await call(contactRequest(validPayload), db)).status, 200);
    }
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
