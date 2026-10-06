// Unit tests for the CSP report endpoint (functions/api/csp-report.ts):
// normalization of both report formats (legacy report-uri and the Reporting
// API), the noise filters (foreign documents, browser extensions, extension-
// injected inline violations), and the D1 persistence paths.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../../functions/api/csp-report.ts';
import { createD1Stub } from './helpers/d1-stub.ts';
import { createD1Sqlite } from './helpers/d1-sqlite.ts';
import type { CspReportRow } from '../../functions/lib/database.ts';
import { postRequest } from './helpers/requests.ts';

const reportRequest = (body: unknown, contentType = 'application/csp-report', headers: Record<string, string> = {}): Request =>
  postRequest('https://jseverino.com/api/csp-report', body, { 'Content-Type': contentType, ...headers });

function call(request: Request, db: { prepare: unknown } = createD1Stub()) {
  return onRequestPost({ request, env: { DB: db } } as Parameters<typeof onRequestPost>[0]);
}

const inserts = (db: ReturnType<typeof createD1Stub>) => db.queries.filter((entry) => /INSERT INTO csp_reports/.test(entry.query));

const legacyReport = {
  'csp-report': {
    'document-uri': 'https://jseverino.com/contact/',
    'blocked-uri': 'https://evil.example/payload.js',
    'effective-directive': 'script-src-elem',
    'violated-directive': 'script-src-elem',
    disposition: 'enforce',
    'source-file': 'https://jseverino.com/contact/',
    'line-number': 12,
    'status-code': 200,
  },
};

describe('request validation', () => {
  test('rejects unexpected content types with 415', async () => {
    const response = await call(reportRequest(legacyReport, 'text/plain'));
    assert.equal(response.status, 415);
  });

  test('accepts media-type parameters without allowing substring matches', async () => {
    for (const contentType of ['application/jsonp', 'text/plain; note=application/csp-report']) {
      assert.equal((await call(reportRequest(legacyReport, contentType))).status, 415);
    }
    assert.equal((await call(reportRequest(legacyReport, 'Application/CSP-Report; charset=utf-8'))).status, 204);
  });

  test('rejects an oversized body with 413', async () => {
    const padded = { 'csp-report': { ...legacyReport['csp-report'], referrer: 'r'.repeat(17_000) } };
    const response = await call(reportRequest(padded));
    assert.equal(response.status, 413);
  });

  test('rejects malformed JSON with 400', async () => {
    const response = await call(reportRequest('{nope'));
    assert.equal(response.status, 400);
  });

  test('counts multibyte reports by bytes before database work', async () => {
    const db = createD1Stub();
    const padded = { 'csp-report': { ...legacyReport['csp-report'], referrer: '€'.repeat(6_000) } };
    const response = await call(reportRequest(padded), db);
    assert.equal(response.status, 413);
    assert.equal(db.queries.length, 0);
  });
});

describe('noise filtering', () => {
  test('drops reports for documents that are not this site', async () => {
    const foreign = { 'csp-report': { ...legacyReport['csp-report'], 'document-uri': 'https://other.example/' } };
    const db = createD1Stub();
    const response = await call(reportRequest(foreign), db);
    assert.equal(response.status, 400);
    assert.equal(db.queries.length, 0);
  });

  test('drops browser-extension violations, by blocked URI or by source file', async () => {
    for (const scheme of ['chrome-extension', 'moz-extension', 'safari-extension', 'safari-web-extension', 'edge-extension']) {
      for (const field of ['blocked-uri', 'source-file']) {
        const extension = { 'csp-report': { ...legacyReport['csp-report'], [field]: `${scheme}://abcdef/inject.js` } };
        const db = createD1Stub();
        const response = await call(reportRequest(extension), db);
        assert.equal(response.status, 400, `${scheme} ${field}`);
        assert.equal(db.queries.length, 0, `${scheme} ${field}`);
      }
    }
  });

  test('drops extension-injected inline violations attributed to the page itself', async () => {
    const injected = {
      type: 'csp-violation',
      url: 'https://jseverino.com/',
      body: {
        documentURL: 'https://jseverino.com/',
        blockedURL: 'inline',
        effectiveDirective: 'style-src-attr',
        disposition: 'enforce',
        sourceFile: 'https://jseverino.com/',
      },
    };
    const response = await call(reportRequest(injected, 'application/reports+json'));
    assert.equal(response.status, 400);
  });

  test('drops Reporting API entries that are not csp-violations', async () => {
    const other = { type: 'deprecation', url: 'https://jseverino.com/', body: {} };
    const response = await call(reportRequest(other, 'application/reports+json'));
    assert.equal(response.status, 400);
  });
});

describe('persistence', () => {
  test('stores a Reporting API csp-violation', async () => {
    const report = {
      type: 'csp-violation',
      url: 'https://jseverino.com/portfolio/',
      body: {
        documentURL: 'https://jseverino.com/portfolio/',
        blockedURL: 'https://evil.example/tracker.js',
        effectiveDirective: 'script-src-elem',
        disposition: 'enforce',
        sourceFile: 'https://jseverino.com/portfolio/',
        lineNumber: 3,
      },
    };
    const db = createD1Stub();
    const response = await call(reportRequest(report, 'application/reports+json'), db);
    assert.equal(response.status, 204);
    assert.equal(inserts(db)[0]?.values[0], 'https://jseverino.com/portfolio/');
    assert.equal(inserts(db)[0]?.values[1], 'https://evil.example/tracker.js');
  });

  test('writes every report of a request in one batch', async () => {
    const db = createD1Stub();
    let batches = 0;
    const batch = db.batch.bind(db);
    db.batch = async (statements) => {
      batches += 1;
      return batch(statements);
    };
    await call(reportRequest([legacyReport, legacyReport]), db);
    assert.equal(batches, 1);
    assert.equal(inserts(db).length, 2);
  });

  test('caps a report batch at ten inserts', async () => {
    const batch = Array.from({ length: 12 }, () => legacyReport);
    const db = createD1Stub();
    const response = await call(reportRequest(batch), db);
    assert.equal(response.status, 204);
    assert.equal(inserts(db).length, 10);
  });

  test('returns 500 when the D1 insert fails', async () => {
    const db = createD1Stub({ failRun: true });
    const response = await call(reportRequest(legacyReport), db);
    assert.equal(response.status, 500);
  });
});

describe('write bounds', () => {
  const distinct = (line: number) => ({ 'csp-report': { ...legacyReport['csp-report'], 'line-number': line } });
  const fromIp = (body: unknown, ip = '203.0.113.7') => reportRequest(body, 'application/csp-report', { 'CF-Connecting-IP': ip });

  test('stores a report identical to one from the last hour only once', async () => {
    const db = createD1Sqlite();
    assert.equal((await call(fromIp([legacyReport, legacyReport]), db)).status, 204);
    assert.equal((await call(fromIp(legacyReport, '198.51.100.9'), db)).status, 204);
    assert.equal(db.count('csp_reports'), 1);
    await call(fromIp(distinct(99)), db);
    assert.equal(db.count('csp_reports'), 2);
  });

  test('stores at most thirty reports per IP per hour', async () => {
    const db = createD1Sqlite();
    for (let batch = 0; batch < 4; batch += 1) {
      const reports = Array.from({ length: 10 }, (_, i) => distinct(batch * 10 + i));
      assert.equal((await call(fromIp(reports), db)).status, 204);
    }
    assert.equal(db.count('csp_reports'), 30);
    await call(fromIp(distinct(1_000), '198.51.100.9'), db);
    assert.equal(db.count('csp_reports'), 31);
  });

  test('drops reports older than the retention window in the same batch', async () => {
    const db = createD1Sqlite();
    const seed = (age: string) =>
      db.prepare(`INSERT INTO csp_reports (blocked_uri, raw_report, created_at) VALUES (?1, '{}', datetime('now', ?2))`).bind(`https://seed.example/${age}`, age).run();
    await seed('-61 days');
    await seed('-59 days');
    assert.equal(db.count('csp_reports'), 2);
    assert.equal((await call(fromIp(distinct(1)), db)).status, 204);
    const kept = async (age: string) =>
      (await db.prepare('SELECT COUNT(*) AS n FROM csp_reports WHERE blocked_uri = ?1').bind(`https://seed.example/${age}`).first<{ n: number }>())?.n;
    assert.equal(await kept('-61 days'), 0, 'the 61-day-old report is purged');
    assert.equal(await kept('-59 days'), 1, 'the 59-day-old report is kept');
    assert.equal(db.count('csp_reports'), 2);
  });

  test('stores the normalized fields and caller metadata', async () => {
    const db = createD1Sqlite();
    const response = await call(reportRequest(legacyReport, 'application/csp-report', {
      'CF-Connecting-IP': '203.0.113.7',
      'CF-IPCountry': 'US',
      'User-Agent': '  Mozilla/5.0  ',
    }), db);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const row = await db.prepare('SELECT * FROM csp_reports').first<CspReportRow>();
    assert.ok(row);
    assert.equal(row.document_uri, 'https://jseverino.com/contact/');
    assert.equal(row.blocked_uri, 'https://evil.example/payload.js');
    assert.equal(row.effective_directive, 'script-src-elem');
    assert.equal(row.disposition, 'enforce');
    assert.equal(row.source_file, 'https://jseverino.com/contact/');
    assert.equal(row.status_code, 200);
    assert.equal(row.line_number, 12);
    assert.equal(row.ip_address, '203.0.113.7');
    assert.equal(row.country, 'US');
    assert.equal(row.user_agent, 'Mozilla/5.0');
  });
});
