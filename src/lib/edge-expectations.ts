// What a correctly served response looks like at the edge, as pure functions
// over status, headers, and body that return a list of findings (empty means
// correct). tests/edge asserts these against `wrangler pages dev` before a
// deploy; bin/deploy-verify.ts asserts the same functions against production
// after one, so both sides use one definition of "correct".
//
// `headers` is a plain object keyed by lower-cased header name, which is what
// Playwright's response.headers() returns; headersToRecord() produces the same
// shape from a fetch Response.
import { SITE_ORIGIN as siteOrigin } from './site-config.ts';
import { CSP_NONCE_ATTRIBUTE, CSP_NONCE_PLACEHOLDER } from '../../functions/lib/csp-nonce.ts';

export { siteOrigin };
export const cspReportPath = '/api/csp-report';
export const cspReportUri = `${siteOrigin}${cspReportPath}`;

// Lower-cased header name to value: Playwright's response.headers() shape.
export type HeaderRecord = Record<string, string>;

const nonceRe = /'nonce-([A-Za-z0-9+/=]+)'/;

export const nonceFromCsp = (csp: string | null | undefined): string | null => nonceRe.exec(csp ?? '')?.[1] ?? null;

export function headersToRecord(headers: Headers): HeaderRecord {
  const record: HeaderRecord = {};
  headers.forEach((value, name) => {
    record[name.toLowerCase()] = value;
  });
  return record;
}

// The per-request policies functions/_middleware.ts issues on every HTML
// response: the enforced policy, and the report-only companion that stages
// Trusted Types and 'strict-dynamic' until /api/csp-report shows them clean.
export function cspFindings(headers: HeaderRecord): string[] {
  const findings: string[] = [];
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
  // report-uri is the fallback for browsers that ignore report-to (Firefox).
  if (!csp.includes(`report-uri ${cspReportUri}`)) findings.push(`content-security-policy lacks the report-uri ${cspReportUri} fallback`);
  if (/script-src[^;]*'unsafe-inline'/.test(csp)) findings.push("script-src falls back to 'unsafe-inline'");
  // The Web Analytics beacon passes by nonce or host. A pinned hash goes stale
  // whenever Cloudflare reships the beacon, silently.
  if (!/script-src[^;]*https:\/\/static\.cloudflareinsights\.com/.test(csp)) findings.push('script-src does not allow the Web Analytics beacon host');
  if (/'sha(256|384|512)-/.test(csp + (headers['content-security-policy-report-only'] ?? ''))) findings.push('a policy pins a script hash');
  if (nonce && !new RegExp(`style-src[^;]*'nonce-${RegExp.escape(nonce)}'`).test(csp)) {
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

export function staticHeaderFindings(headers: HeaderRecord): string[] {
  const findings: string[] = [];
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
export function hstsFindings(headers: HeaderRecord): string[] {
  const value = headers['strict-transport-security'] ?? '';
  return /includesubdomains/i.test(value) ? [] : [`strict-transport-security is ${value || '<missing>'}, expected includeSubDomains`];
}

// A page that renders but whose scripts (or its inlined stylesheet) carry a
// different nonce than the header executes nothing and paints unstyled, and no
// status code would notice. The middleware nonces only tags the build stamped
// with the placeholder, so a surviving placeholder means the swap did not run.
export const scriptTagCount = (html: string): number => (html.match(/<script\b/g) ?? []).length;
export const styleTagCount = (html: string): number => (html.match(/<style\b/g) ?? []).length;

export function nonceParityFindings(html: string, nonce: string | null): string[] {
  if (!nonce) return ['no nonce to check script and style tags against'];
  const scripts = scriptTagCount(html);
  const styles = styleTagCount(html);
  const stamped = html.split(`nonce="${nonce}"`).length - 1;
  const findings: string[] = [];
  if (scripts === 0) findings.push('the page renders no script tags');
  if (styles === 0) findings.push('the page renders no inlined stylesheet');
  if (stamped !== scripts + styles) findings.push(`${stamped} of ${scripts} script and ${styles} style tags carry the header nonce`);
  findings.push(...placeholderFindings(html));
  return findings;
}

// The build-time attribute, matched as markup so page text that mentions the
// placeholder is not a finding.
export const placeholderFindings = (html: string): string[] =>
  html.includes(CSP_NONCE_ATTRIBUTE) ? [`the build-time ${CSP_NONCE_PLACEHOLDER} placeholder reached the response`] : [];

// The policy public/_headers sets on every path _routes.json excludes from
// Functions. Those responses never pass the middleware; a miss under them is
// the prefix's static fallback page, which needs no script or inline style.
export const STATIC_CSP = "default-src 'none'; img-src 'self'; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

export function staticCspFindings(headers: HeaderRecord): string[] {
  const csp = headers['content-security-policy'];
  return csp === STATIC_CSP ? [] : [`content-security-policy is ${csp ?? '<missing>'}, expected the static policy`];
}

export function cacheRuleFindings(headers: HeaderRecord, { immutable }: { immutable: boolean }): string[] {
  const value = headers['cache-control'] ?? '';
  const findings: string[] = [];
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
export function contactRefusalFindings(status: number, payload: unknown): string[] {
  const findings: string[] = [];
  const body: { ok?: unknown; error?: unknown } = payload && typeof payload === 'object' ? payload : {};
  if (status !== 400) findings.push(`status ${status}, expected 400`);
  if (body.ok !== false) findings.push('payload does not carry ok: false');
  if (!/verification/i.test(typeof body.error === 'string' ? body.error : '')) findings.push('error does not name the verification challenge');
  return findings;
}
