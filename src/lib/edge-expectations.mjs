// What a correctly served response looks like at the edge, as pure functions
// over status, headers, and body that return a list of findings (empty means
// correct). tests/edge asserts these against `wrangler pages dev` before a
// deploy; bin/deploy-verify.mjs asserts the same functions against production
// after one. One definition, so the two can never disagree about "correct".
//
// `headers` is a plain object keyed by lower-cased header name, which is what
// Playwright's response.headers() returns; headersToRecord() produces the same
// shape from a fetch Response.
import { escapeRegExp } from './escape-regexp.mjs';
import { SITE } from './site-config.mjs';

export const siteOrigin = `https://${SITE.domain}`;
export const cspReportPath = '/api/csp-report';
export const cspReportUri = `${siteOrigin}${cspReportPath}`;

const nonceRe = /'nonce-([A-Za-z0-9+/=]+)'/;

export const nonceFromCsp = (csp) => nonceRe.exec(csp ?? '')?.[1] ?? null;

export function headersToRecord(headers) {
  const record = {};
  headers.forEach((value, name) => {
    record[name.toLowerCase()] = value;
  });
  return record;
}

// The per-request policies functions/_middleware.ts issues on every HTML
// response: the enforced policy, and the report-only companion that stages
// Trusted Types and 'strict-dynamic' until /api/csp-report shows them clean.
export function cspFindings(headers) {
  const findings = [];
  const csp = headers['content-security-policy'] ?? '';
  const nonce = nonceFromCsp(csp);
  if (!nonce) findings.push('content-security-policy carries no script nonce');
  for (const clause of [
    "default-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    'report-to csp-endpoint',
  ]) {
    if (!csp.includes(clause)) findings.push(`content-security-policy lacks ${clause}`);
  }
  if (csp.includes('report-uri')) findings.push('content-security-policy still carries the deprecated report-uri');
  if (/script-src[^;]*'unsafe-inline'/.test(csp)) findings.push("script-src falls back to 'unsafe-inline'");
  if (nonce && !new RegExp(`style-src[^;]*'nonce-${escapeRegExp(nonce)}'`).test(csp)) {
    findings.push('style-src does not carry the request nonce the inlined stylesheet needs');
  }

  const reportOnly = headers['content-security-policy-report-only'] ?? '';
  for (const clause of ["require-trusted-types-for 'script'", "'strict-dynamic'", 'report-to csp-endpoint']) {
    if (!reportOnly.includes(clause)) findings.push(`the report-only policy lacks ${clause}`);
  }
  if (nonce && !reportOnly.includes(`'nonce-${nonce}'`)) findings.push('the report-only policy carries a different nonce than the enforced one');

  if (!(headers['reporting-endpoints'] ?? '').includes(cspReportPath)) {
    findings.push(`reporting-endpoints lacks ${cspReportPath}`);
  }
  return findings;
}

// The static rules public/_headers applies to every route.
export const staticSecurityHeaders = Object.freeze({
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'x-permitted-cross-domain-policies': 'none',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-site',
});

export function staticHeaderFindings(headers) {
  const findings = [];
  for (const [name, expected] of Object.entries(staticSecurityHeaders)) {
    const received = headers[name];
    if ((received ?? '').toLowerCase() !== expected.toLowerCase()) {
      findings.push(`${name} is ${received ?? '<missing>'}, expected ${expected}`);
    }
  }
  if (!(headers['permissions-policy'] ?? '').includes('camera=()')) findings.push('permissions-policy does not deny the camera');
  if (headers['access-control-allow-origin'] !== undefined) findings.push('access-control-allow-origin leaks onto an HTML response');
  return findings;
}

// HSTS is a Cloudflare zone setting rather than a build artifact, so only a
// production probe can assert it.
export function hstsFindings(headers) {
  const value = headers['strict-transport-security'] ?? '';
  return /includesubdomains/i.test(value) ? [] : [`strict-transport-security is ${value || '<missing>'}, expected includeSubDomains`];
}

// A page that renders but whose scripts (or its inlined stylesheet) carry a
// different nonce than the header executes nothing and paints unstyled, and no
// status code would notice.
export const scriptTagCount = (html) => (html.match(/<script\b/g) ?? []).length;
export const styleTagCount = (html) => (html.match(/<style\b/g) ?? []).length;

export function nonceParityFindings(html, nonce) {
  if (!nonce) return ['no nonce to check script and style tags against'];
  const scripts = scriptTagCount(html);
  const styles = styleTagCount(html);
  const stamped = html.split(`nonce="${nonce}"`).length - 1;
  const findings = [];
  if (scripts === 0) findings.push('the page renders no script tags');
  if (styles === 0) findings.push('the page renders no inlined stylesheet');
  if (stamped !== scripts + styles) findings.push(`${stamped} of ${scripts} script and ${styles} style tags carry the header nonce`);
  return findings;
}

export function cacheRuleFindings(headers, { immutable }) {
  const value = headers['cache-control'] ?? '';
  const findings = [];
  if (immutable) {
    if (!value.includes('max-age=31536000') || !value.includes('immutable')) findings.push(`fingerprinted asset cache-control is ${value || '<missing>'}`);
  } else {
    if (!value.includes('max-age=3600') || !value.includes('must-revalidate')) findings.push(`chrome asset cache-control is ${value || '<missing>'}`);
    if (value.includes('immutable')) findings.push('a chrome asset is pinned immutable, which would hold a stale logo for a year');
  }
  if (headers['access-control-allow-origin'] !== undefined) findings.push('access-control-allow-origin leaks onto a static asset');
  return findings;
}

// The contact function must refuse a submission without a Turnstile token
// before the honeypot, the Turnstile call, and the D1 write.
export function contactRefusalFindings(status, payload) {
  const findings = [];
  if (status !== 400) findings.push(`status ${status}, expected 400`);
  if (payload?.ok !== false) findings.push('payload does not carry ok: false');
  if (!/verification/i.test(payload?.error ?? '')) findings.push('error does not name the verification challenge');
  return findings;
}
