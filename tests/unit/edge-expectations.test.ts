import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CSP_INLINE_MARKER, hashSource, htmlPolicy, trustedTypesReportOnly } from '../../functions/lib/csp.ts';
import {
  cacheRuleFindings,
  contactRefusalFindings,
  cspFindings,
  cspReportPath,
  cspReportUri,
  hstsFindings,
  inlineHashFindings,
  staticHeaderFindings,
  trustedTypesExempt,
} from '../../src/lib/edge-expectations.ts';

const script = 'theme()';
const style = 'body{}';
const page = `<html><head><script>${script}</script><style>${style}</style></head><body></body></html>`;

async function policyFor(trustedTypes: boolean): Promise<string> {
  return htmlPolicy({ scriptHashes: [await hashSource(script)], styleHashes: [await hashSource(style)], reportUri: cspReportUri, trustedTypes });
}

const withPolicy = (csp: string, extra: Record<string, string> = {}) => ({
  'content-security-policy': csp,
  'reporting-endpoints': `csp-endpoint="${cspReportUri}"`,
  ...extra,
});

describe('cspFindings', () => {
  test('a correct policy has no findings, on a page and on the exempt contact page', async () => {
    assert.deepEqual(cspFindings(withPolicy(await policyFor(true)), '/'), []);
    const contact = withPolicy(await policyFor(false), { 'content-security-policy-report-only': trustedTypesReportOnly(cspReportUri) });
    assert.deepEqual(cspFindings(contact, '/contact/'), []);
  });

  test('names a missing policy', () => {
    assert.ok(cspFindings({}, '/').length > 3);
  });

  test('flags every escape hatch', async () => {
    const policy = (await policyFor(true)).replace("script-src 'self'", "script-src 'self' 'unsafe-inline' 'strict-dynamic' blob: 'nonce-abc'");
    const findings = cspFindings(withPolicy(policy), '/').join(' | ');
    for (const banned of ["'unsafe-inline'", "'strict-dynamic'", 'blob:', 'nonce-']) assert.match(findings, new RegExp(`script-src carries ${banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  test('flags a leftover build placeholder and a policy with no hash', async () => {
    assert.match(cspFindings(withPolicy('default-src __CSP__'), '/').join('|'), /placeholder/);
    const noHashes = htmlPolicy({ scriptHashes: [], styleHashes: [], reportUri: cspReportUri, trustedTypes: true });
    const findings = cspFindings(withPolicy(noHashes), '/');
    assert.ok(findings.some((finding) => /no hash for the inline theme script/.test(finding)));
    assert.ok(findings.some((finding) => /no hash for the inlined stylesheet/.test(finding)));
  });

  test('enforces Trusted Types everywhere but the contact page, and nowhere twice', async () => {
    assert.ok(cspFindings(withPolicy(await policyFor(false)), '/').some((finding) => /lacks require-trusted-types-for/.test(finding)));
    assert.ok(cspFindings(withPolicy(await policyFor(true)), '/contact/').some((finding) => /exempt page enforces Trusted Types/.test(finding)));
    const reported = withPolicy(await policyFor(true), { 'content-security-policy-report-only': trustedTypesReportOnly(cspReportUri) });
    assert.ok(cspFindings(reported, '/').some((finding) => /report-only policy is still issued/.test(finding)));
  });

  test('requires the reporting endpoint', async () => {
    assert.ok(cspFindings({ 'content-security-policy': await policyFor(true) }, '/').some((finding) => finding.includes(cspReportPath)));
  });
});

describe('trustedTypesExempt', () => {
  test('is the contact page with or without a trailing slash, and nothing else', () => {
    assert.ok(trustedTypesExempt('/contact') && trustedTypesExempt('/contact/'));
    assert.ok(!trustedTypesExempt('/contact-notes/') && !trustedTypesExempt('/') && !trustedTypesExempt('/about/contact/'));
  });
});

describe('inlineHashFindings', () => {
  test('passes a page whose inline script and style are in the policy', async () => {
    assert.deepEqual(await inlineHashFindings(page, await policyFor(true)), []);
  });

  test('names an inline script the policy does not cover', async () => {
    const findings = await inlineHashFindings(page.replace(script, 'other()'), await policyFor(true));
    assert.equal(findings.length, 1);
    assert.match(findings[0] ?? '', /does not carry the hash of an inline tag/);
  });

  test('flags a page with no inline script or style, a missing policy, a marker, and a nonce attribute', async () => {
    assert.equal((await inlineHashFindings('<html><body></body></html>', await policyFor(true))).length, 2);
    assert.ok((await inlineHashFindings(page, undefined)).length >= 2);
    assert.ok((await inlineHashFindings(`${page}<!-- ${CSP_INLINE_MARKER} -->`, await policyFor(true))).some((finding) => /marker reached the response/.test(finding)));
    assert.ok((await inlineHashFindings(page.replace('<script>', '<script nonce="abc">'), await policyFor(true))).some((finding) => /nonce attribute/.test(finding)));
  });
});

describe('header and cache predicates', () => {
  test('staticHeaderFindings names each missing or wrong header and a leaked CORS header', () => {
    const findings = staticHeaderFindings({ 'x-content-type-options': 'sniff', 'access-control-allow-origin': '*' }).join(' | ');
    assert.match(findings, /x-content-type-options is sniff, expected nosniff/);
    assert.match(findings, /referrer-policy is <missing>/);
    assert.match(findings, /permissions-policy does not deny the camera/);
    assert.match(findings, /access-control-allow-origin leaks/);
  });

  test('hstsFindings wants includeSubDomains', () => {
    assert.deepEqual(hstsFindings({ 'strict-transport-security': 'max-age=31536000; includeSubDomains' }), []);
    assert.equal(hstsFindings({}).length, 1);
  });

  test('cacheRuleFindings separates fingerprinted from chrome assets', () => {
    assert.deepEqual(cacheRuleFindings({ 'cache-control': 'public, max-age=31536000, immutable' }, { immutable: true }), []);
    assert.deepEqual(cacheRuleFindings({ 'cache-control': 'public, max-age=3600, must-revalidate' }, { immutable: false }), []);
    assert.ok(cacheRuleFindings({ 'cache-control': 'public, max-age=31536000, immutable' }, { immutable: false }).some((finding) => /immutable/.test(finding)));
    assert.ok(cacheRuleFindings({ 'cache-control': 'max-age=60' }, { immutable: true }).length >= 1);
  });

  test('contactRefusalFindings accepts only the 400 verification refusal', () => {
    assert.deepEqual(contactRefusalFindings(400, { ok: false, error: 'Verification failed.' }), []);
    assert.equal(contactRefusalFindings(200, { ok: true }).length, 3);
  });
});
