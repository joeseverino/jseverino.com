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

function reportRequest(body: unknown, contentType = 'application/csp-report') {
  return new Request('https://jseverino.com/api/csp-report', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function call(request: Request, db = createD1Stub()) {
  return onRequestPost({ request, env: { DB: db } } as Parameters<typeof onRequestPost>[0]);
}

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

  test('rejects an oversized body with 413', async () => {
    const padded = { 'csp-report': { ...legacyReport['csp-report'], referrer: 'r'.repeat(17_000) } };
    const response = await call(reportRequest(padded));
    assert.equal(response.status, 413);
  });

  test('rejects malformed JSON with 400', async () => {
    const response = await call(reportRequest('{nope'));
    assert.equal(response.status, 400);
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

  test('drops browser-extension violations', async () => {
    const extension = { 'csp-report': { ...legacyReport['csp-report'], 'blocked-uri': 'chrome-extension://abcdef' } };
    const response = await call(reportRequest(extension));
    assert.equal(response.status, 400);
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
  test('stores a normalized legacy report and returns 204', async () => {
    const db = createD1Stub();
    const response = await call(reportRequest(legacyReport));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  });

  test('binds the normalized legacy fields in column order', async () => {
    const db = createD1Stub();
    await call(reportRequest(legacyReport), db);
    assert.equal(db.queries.length, 1);
    assert.match(db.queries[0].query, /INSERT INTO csp_reports/);
    const [documentUri, blockedUri, effectiveDirective, , disposition, , sourceFile, lineNumber, , statusCode] =
      db.queries[0].values;
    assert.equal(documentUri, 'https://jseverino.com/contact/');
    assert.equal(blockedUri, 'https://evil.example/payload.js');
    assert.equal(effectiveDirective, 'script-src-elem');
    assert.equal(disposition, 'enforce');
    assert.equal(sourceFile, 'https://jseverino.com/contact/');
    assert.equal(lineNumber, 12);
    assert.equal(statusCode, 200);
  });

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
    assert.equal(db.queries[0].values[0], 'https://jseverino.com/portfolio/');
    assert.equal(db.queries[0].values[1], 'https://evil.example/tracker.js');
  });

  test('caps a report batch at ten inserts', async () => {
    const batch = Array.from({ length: 12 }, () => legacyReport);
    const db = createD1Stub();
    const response = await call(reportRequest(batch), db);
    assert.equal(response.status, 204);
    assert.equal(db.queries.length, 10);
  });

  test('returns 500 when the D1 insert fails', async () => {
    const db = createD1Stub({ failRun: true });
    const response = await call(reportRequest(legacyReport), db);
    assert.equal(response.status, 500);
  });
});
