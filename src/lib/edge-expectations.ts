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
import { CSP_INLINE_MARKER, TRUSTED_TYPES, inlineHashes } from '../../functions/lib/csp.ts';

export { siteOrigin };
export const cspReportPath = '/api/csp-report';
export const cspReportUri = `${siteOrigin}${cspReportPath}`;

// Lower-cased header name to value: Playwright's response.headers() shape.
export type HeaderRecord = Record<string, string>;

export const trustedTypesExempt = (pathname: string): boolean => pathname.replace(/\/+$/, '') === '/contact';

export function headersToRecord(headers: Headers): HeaderRecord {
  const record: HeaderRecord = {};
  headers.forEach((value, name) => {
    record[name.toLowerCase()] = value;
  });
  return record;
}

// The policy public/_headers gives every route, once bin/build-csp.ts has
// filled in the hashes. Trusted Types is enforced on every page except the
// contact form, which keeps it report-only because Turnstile's script trips it.
export function cspFindings(headers: HeaderRecord, pathname = '/'): string[] {
  const findings: string[] = [];
  const csp = headers['content-security-policy'] ?? '';
  const directive = (name: string): string => new RegExp(`(?:^|;\\s*)${name}\\s([^;]*)`).exec(csp)?.[1] ?? '';
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
  if (csp.includes('__')) findings.push('content-security-policy still carries a build placeholder');

  // No nonces and no escape hatches: the page's own inline code is covered by
  // hashes, everything else by 'self' and two named hosts.
  const script = directive('script-src');
  const style = directive('style-src');
  if (!script.includes("'self'")) findings.push("script-src lacks 'self'");
  if (!/'sha256-[A-Za-z0-9+/=]+'/.test(script)) findings.push('script-src carries no hash for the inline theme script');
  for (const banned of ["'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'", 'blob:', 'nonce-']) {
    if (script.includes(banned)) findings.push(`script-src carries ${banned}`);
    if (style.includes(banned)) findings.push(`style-src carries ${banned}`);
  }
  if (!style.includes("'self'")) findings.push("style-src lacks 'self'");
  if (!/'sha256-[A-Za-z0-9+/=]+'/.test(style)) findings.push('style-src carries no hash for the inlined stylesheet');

  const reportOnly = headers['content-security-policy-report-only'] ?? '';
  if (trustedTypesExempt(pathname)) {
    if (csp.includes(TRUSTED_TYPES)) findings.push('the exempt page enforces Trusted Types');
    if (!reportOnly.includes(TRUSTED_TYPES)) findings.push(`the report-only policy lacks ${TRUSTED_TYPES}`);
  } else {
    if (!csp.includes(TRUSTED_TYPES)) findings.push(`content-security-policy lacks ${TRUSTED_TYPES}`);
    if (reportOnly) findings.push('a report-only policy is still issued');
  }

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

// A page whose inline script or stylesheet is not covered by the policy that
// ships beside it runs unthemed or unstyled, and no status code would notice.
// Every inline script and style on the page must have its hash in the header,
// and the build-time marker must not reach the response.
export async function inlineHashFindings(html: string, csp: string | null | undefined): Promise<string[]> {
  const findings: string[] = [];
  const { scriptHashes, styleHashes } = await inlineHashes(html);
  if (scriptHashes.length === 0) findings.push('the page carries no inline theme script');
  if (styleHashes.length === 0) findings.push('the page carries no inlined stylesheet');
  for (const hash of [...scriptHashes, ...styleHashes]) {
    if (!(csp ?? '').includes(`'${hash}'`)) findings.push(`content-security-policy does not carry the hash of an inline tag (${hash})`);
  }
  if (html.includes(CSP_INLINE_MARKER)) findings.push(`the build-time ${CSP_INLINE_MARKER} marker reached the response`);
  if (/<(?:script|style)\b[^>]*\snonce=/i.test(html)) findings.push('a script or style tag still carries a nonce attribute');
  return findings;
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
