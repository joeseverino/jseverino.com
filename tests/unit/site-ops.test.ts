import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, beforeEach, describe, test } from 'node:test';
import { abbreviateName, contactSubmissions, cspCounts, cspReports, preview, redactEmail, type SiteOpsConfig, SiteOpsError } from '../../bin/lib/site-ops.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const scratch = scratchDirs('site-ops-');

function config(overrides: Partial<SiteOpsConfig> = {}): SiteOpsConfig {
  const root = scratch.make();
  return {
    d1Database: 'jseverino-contact',
    auditLog: path.join(root, 'state', 'audit.log'),
    token: undefined,
    accountId: undefined,
    fetch: globalThis.fetch,
    ...overrides,
  };
}

after(scratch.cleanup);

describe('redaction helpers', () => {
  test('emails keep the domain, names abbreviate, previews collapse', () => {
    assert.equal(redactEmail('jane@acme.com'), 'j***@acme.com');
    assert.equal(redactEmail('nope'), '***');
    assert.equal(abbreviateName('Jane Q Doe'), 'Jane D.');
    assert.equal(abbreviateName('Cher'), 'Cher');
    assert.equal(preview('a\n  b   c'), 'a b c');
    assert.equal(preview('x'.repeat(100)).length, 81);
  });
});

interface Sent {
  method: string;
  url: string;
  auth: string | null;
  body: { sql: string; params: unknown[] } | undefined;
}
let sent: Sent[] = [];
let queryReply: (body: { sql: string; params: unknown[] }) => object[] = () => [];

// Cloudflare's D1 API: the list endpoint finds the database by name, the query endpoint takes { sql, params }.
const d1Fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  sent.push({ method: String(init?.method), url: String(url), auth: new Headers(init?.headers).get('authorization'), body });
  const envelope = (result: unknown) => new Response(JSON.stringify({ success: true, errors: [], result }), { status: 200 });
  if (String(url).includes('/d1/database?')) return envelope([{ uuid: 'db-uuid', name: 'jseverino-contact' }]);
  return envelope([{ success: true, results: queryReply(body), meta: {} }]);
}) as typeof fetch;

const reader = (overrides: Partial<SiteOpsConfig> = {}) => config({ token: 'tok', accountId: 'acct', fetch: d1Fetch, ...overrides });
const last = (): Sent => sent.at(-1) as Sent;
beforeEach(() => {
  sent = [];
  queryReply = () => [];
});

describe('contact submissions', () => {
  const row = {
    id: 1,
    created_at: '2026-10-01',
    name: 'Jane Doe',
    email: 'jane@acme.com',
    message: 'Hello there',
    ip_address: '203.0.113.9',
    user_agent: 'UA',
  };

  test('finds the database by name, then queries it with the limit as a bound parameter', async () => {
    queryReply = () => [row];
    await contactSubmissions(reader(), { limit: 500 });
    assert.equal(sent[0]?.method, 'GET');
    assert.match(sent[0]?.url ?? '', /\/accounts\/acct\/d1\/database\?name=jseverino-contact$/);
    assert.equal(last().method, 'POST');
    assert.match(last().url, /\/accounts\/acct\/d1\/database\/db-uuid\/query$/);
    assert.equal(last().auth, 'Bearer tok');
    assert.match(last().body?.sql ?? '', /LIMIT \?;$/);
    assert.deepEqual(last().body?.params, [100]);
  });

  test('redacted by default, with no audit line', async () => {
    queryReply = () => [row];
    const cfg = reader();
    const result = await contactSubmissions(cfg);
    assert.equal(result.piiReleased, false);
    assert.deepEqual(result.results[0], {
      id: 1,
      created_at: '2026-10-01',
      name: 'Jane D.',
      email: 'j***@acme.com',
      message_preview: 'Hello there',
      message_chars: 11,
      status: undefined,
      browser: undefined,
      device: undefined,
      country: undefined,
      source_url: undefined,
    });
    assert.equal(fs.existsSync(cfg.auditLog), false);
  });

  test('--pii returns full rows and writes one audit line without the PII', async () => {
    queryReply = () => [row];
    const cfg = reader();
    const result = await contactSubmissions(cfg, { includePii: true });
    assert.equal(result.results[0]?.email, 'jane@acme.com');
    const log = fs.readFileSync(cfg.auditLog, 'utf8');
    assert.match(log, /action=contact_pii_access rows=1 client=site/);
    assert.doesNotMatch(log, /jane/);
  });

  test('--pii releases nothing when the audit line cannot be written', async () => {
    queryReply = () => [row];
    const cfg = reader();
    write(cfg.auditLog, '');
    fs.chmodSync(cfg.auditLog, 0o400);
    await assert.rejects(contactSubmissions(cfg, { includePii: true }), (error) => error instanceof SiteOpsError && /audit log/.test(error.message));
  });

  test('an API failure surfaces as an error', async () => {
    const failing = (async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }), { status: 403 })) as typeof fetch;
    await assert.rejects(
      contactSubmissions(reader({ fetch: failing })),
      (error) => error instanceof SiteOpsError && /Authentication error/.test(error.message),
    );
  });
});

describe('missing credentials', () => {
  test('each read stops on one line naming the variable and the scope, before any request', async () => {
    for (const read of [contactSubmissions, cspReports, cspCounts]) {
      await assert.rejects(
        read(reader({ token: undefined })),
        (error) => error instanceof SiteOpsError && /^CLOUDFLARE_API_TOKEN is not set.*Account · D1 · Read$/.test(error.message),
      );
      await assert.rejects(
        read(reader({ accountId: undefined })),
        (error) => error instanceof SiteOpsError && /^CLOUDFLARE_ACCOUNT_ID is not set/.test(error.message),
      );
    }
    assert.equal(sent.length, 0);
  });
});

describe('CSP reports', () => {
  test('client fields only with --pii; the directive is a bound parameter, never part of the SQL', async () => {
    const hostile = "script-src'; DROP TABLE x;--";
    await cspReports(reader(), { directive: hostile });
    assert.doesNotMatch(last().body?.sql ?? '', /ip_address|DROP/);
    assert.match(last().body?.sql ?? '', /WHERE effective_directive = \? /);
    assert.deepEqual(last().body?.params, [hostile, 20]);
    await cspReports(reader(), { includePii: true });
    assert.match(last().body?.sql ?? '', /ip_address, user_agent, country, raw_report/);
    assert.deepEqual(last().body?.params, [20]);
  });

  test('counts total and by directive', async () => {
    queryReply = (body) =>
      body.sql.startsWith('SELECT COUNT(*) AS total')
        ? [{ total: 7 }]
        : [
            { effective_directive: 'script-src', count: 5 },
            { effective_directive: '(unknown)', count: 2 },
          ];
    const counts = await cspCounts(reader());
    assert.equal(counts.total, 7);
    assert.deepEqual(
      counts.byDirective.map((row) => row.count),
      [5, 2],
    );
  });
});
