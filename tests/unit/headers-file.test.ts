import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { headersToRecord, staticHeaderFindings } from '../../src/lib/edge-expectations.ts';
import { applyRules, parseHeaders, workerHeaders } from '../../src/lib/headers-file.ts';
import { fromRoot } from '../../src/lib/site-root.ts';

describe('_headers parsing', () => {
  test('a rule repeated in _headers merges its lines', () => {
    const headers = parseHeaders('# c\n/a/*\n  X: 1\n\n/b\n  Y: 2\n/a/*\n  ! Z\n');
    assert.deepEqual(headers.get('/a/*'), ['X: 1', '! Z']);
    assert.deepEqual(headers.get('/b'), ['Y: 2']);
  });

  test('a detach removes what an earlier rule set, before its own rule sets the header again', () => {
    const applied = applyRules([
      ['A: 1', 'B: 2', 'A: 3'],
      ['! a', '! B', 'A: 4'],
    ]);
    assert.deepEqual(Object.fromEntries(applied), { a: '4' });
  });
});

describe('the headers the Worker gives its own responses', () => {
  const headers = headersToRecord(workerHeaders(fs.readFileSync(fromRoot('public/_headers'), 'utf8')));

  test('are the security headers public/_headers gives every static file', () => {
    assert.deepEqual(staticHeaderFindings(headers), []);
  });

  test('fill the placeholders with a hashless policy and the report endpoint', () => {
    assert.ok(!Object.values(headers).some((value) => value.includes('__')), 'no placeholder reaches a response');
    assert.match(headers['content-security-policy'] ?? '', /^default-src 'none'; script-src 'self' https:/);
    assert.match(headers['reporting-endpoints'] ?? '', /csp-endpoint=/);
  });

  test('take only the /* rule, never a path rule', () => {
    const only = headersToRecord(workerHeaders('/assets/*\n  Cache-Control: immutable\n/*\n  X-Test: 1\n'));
    assert.deepEqual(only, { 'x-test': '1' });
  });

  test('take a detach under /* as a removal, never as a header', () => {
    const detached = headersToRecord(workerHeaders('/*\n  ! X-Gone\n  X-Test: 1\n'));
    assert.deepEqual(detached, { 'x-test': '1' });
  });
});
