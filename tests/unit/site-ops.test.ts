import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SiteOpsError, abbreviateName, applyD1Schema, checkSecurityHeaders, contactSubmissions, cspCounts, cspReports, preview,
  redactEmail, type Runner, type SiteOpsConfig,
} from '../../bin/lib/site-ops.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const scratch = scratchDirs('site-ops-');
let calls: string[][] = [];
let reply: (args: readonly string[]) => { code: number; stdout: string; stderr?: string } = () => ({ code: 0, stdout: '[]' });

function config(overrides: Partial<SiteOpsConfig> = {}): SiteOpsConfig {
  const root = scratch.make();
  write(path.join(root, 'node_modules', '.bin', 'wrangler'), '');
  const run: Runner = (_cmd, args) => {
    calls.push([...args]);
    const { code, stdout, stderr = '' } = reply(args);
    return { code, stdout, stderr, error: undefined };
  };
  return {
    d1Database: 'jseverino-contact', siteRepo: root, siteOrigin: 'https://jseverino.com',
    auditLog: path.join(root, 'state', 'audit.log'), run, fetch: globalThis.fetch, ...overrides,
  };
}

const d1 = (results: object[]) => () => ({ code: 0, stdout: JSON.stringify([{ success: true, results, meta: {} }]) });
const sql = (): string => calls.at(-1)?.at(-1) ?? '';

beforeEach(() => { calls = []; reply = () => ({ code: 0, stdout: '[]' }); });
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

describe('contact submissions', () => {
  const row = { id: 1, created_at: '2026-10-01', name: 'Jane Doe', email: 'jane@acme.com', message: 'Hello there', ip_address: '203.0.113.9', user_agent: 'UA' };

  test('redacted by default, with no audit line', () => {
    reply = d1([row]);
    const cfg = config();
    const result = contactSubmissions(cfg, { limit: 500 });
    assert.match(sql(), /LIMIT 100;$/);
    assert.equal(result.piiReleased, false);
    assert.deepEqual(result.results[0], {
      id: 1, created_at: '2026-10-01', name: 'Jane D.', email: 'j***@acme.com', message_preview: 'Hello there', message_chars: 11,
      status: undefined, browser: undefined, device: undefined, country: undefined, source_url: undefined,
    });
    assert.equal(fs.existsSync(cfg.auditLog), false);
  });

  test('--pii returns full rows and writes one audit line without the PII', () => {
    reply = d1([row]);
    const cfg = config();
    const result = contactSubmissions(cfg, { includePii: true });
    assert.equal(result.results[0]?.email, 'jane@acme.com');
    const log = fs.readFileSync(cfg.auditLog, 'utf8');
    assert.match(log, /action=contact_pii_access rows=1 client=site/);
    assert.doesNotMatch(log, /jane/);
  });

  test('a wrangler failure surfaces as an error with its output', () => {
    reply = () => ({ code: 1, stdout: '', stderr: 'Authentication error' });
    assert.throws(() => contactSubmissions(config()), (error) => error instanceof SiteOpsError && /Authentication error/.test(error.message));
  });

  test('uses the site repo\'s own wrangler, remote, JSON', () => {
    reply = d1([]);
    contactSubmissions(config());
    assert.deepEqual(calls[0]?.slice(0, 5), ['d1', 'execute', 'jseverino-contact', '--remote', '--json']);
  });

  test('a missing wrangler names the fix', () => {
    const cfg = config();
    fs.rmSync(path.join(cfg.siteRepo, 'node_modules'), { recursive: true });
    assert.throws(() => contactSubmissions(cfg), /npm ci/);
  });
});

describe('CSP reports', () => {
  test('client fields only with --pii; directives are escaped', () => {
    reply = d1([]);
    cspReports(config(), { directive: "script-src'; DROP TABLE x;--" });
    assert.doesNotMatch(sql(), /ip_address/);
    assert.match(sql(), /WHERE effective_directive = 'script-src''; DROP TABLE x;--'/);
    cspReports(config(), { includePii: true });
    assert.match(sql(), /ip_address, user_agent, country, raw_report/);
  });

  test('counts total and by directive', () => {
    reply = (args) => (String(args.at(-1)).startsWith('SELECT COUNT(*) AS total')
      ? d1([{ total: 7 }])()
      : d1([{ effective_directive: 'script-src', count: 5 }, { effective_directive: '(unknown)', count: 2 }])());
    const counts = cspCounts(config());
    assert.equal(counts.total, 7);
    assert.deepEqual(counts.byDirective.map((row) => row.count), [5, 2]);
  });
});

describe('D1 schema apply', () => {
  test('refuses without confirm and runs nothing', () => {
    assert.throws(() => applyD1Schema(config()), (error) => error instanceof SiteOpsError && error.details.refused === true);
    assert.equal(calls.length, 0);
  });

  test('runs the schema file remotely with confirm', () => {
    reply = () => ({ code: 0, stdout: 'Executed 4 commands' });
    const result = applyD1Schema(config(), { confirm: true });
    assert.equal(result.applied, true);
    assert.deepEqual(calls[0], ['d1', 'execute', 'jseverino-contact', '--remote', '--file=cloudflare/d1.sql']);
  });
});

describe('security headers', () => {
  const headers = {
    'content-security-policy': "default-src 'self'; script-src 'self'; report-uri https://jseverino.com/api/csp-report; report-to csp-endpoint",
    'reporting-endpoints': 'csp-endpoint="https://jseverino.com/api/csp-report"',
  };
  const fakeFetch = (status: number, values: Record<string, string>): typeof fetch =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(init?.method, 'HEAD');
      assert.equal(init?.redirect, 'manual');
      assert.equal(String(url), 'https://jseverino.com/contact/');
      return new Response(null, { status, headers: values });
    }) as typeof fetch;

  test('passes every check on a correct response', async () => {
    const result = await checkSecurityHeaders(config({ fetch: fakeFetch(200, headers) }), '/contact/');
    assert.equal(result.ok, true);
    assert.deepEqual(Object.values(result.checks), [true, true, true, true, true]);
  });

  test('flags an unsafe-inline script source anywhere in script-src', async () => {
    const unsafe = { ...headers, 'content-security-policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; report-to csp-endpoint" };
    const result = await checkSecurityHeaders(config({ fetch: fakeFetch(200, unsafe) }), '/contact/');
    assert.equal(result.checks.noUnsafeInlineScript, false);
  });

  test('flags a missing CSP', async () => {
    const result = await checkSecurityHeaders(config({ fetch: fakeFetch(200, {}) }), '/contact/');
    assert.equal(result.checks.hasCsp, false);
  });

  test('refuses protocol-relative and relative paths', async () => {
    await assert.rejects(checkSecurityHeaders(config(), '//evil.example'), SiteOpsError);
    await assert.rejects(checkSecurityHeaders(config(), 'contact'), SiteOpsError);
  });
});
