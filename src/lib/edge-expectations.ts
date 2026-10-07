// Pure checks returning findings (empty means correct). tests/edge runs them against
// `wrangler pages dev`; bin/deploy-verify.ts runs the same ones against production.
// `headers` is keyed by lower-cased name, as Playwright's response.headers() returns.
import { SITE_ORIGIN as siteOrigin } from './site-config.ts';
import { CSP_INLINE_MARKER, TRUSTED_TYPES, inlineHashes } from '../../functions/lib/csp.ts';

export { siteOrigin };
export const cspReportPath = '/api/csp-report';
export const cspReportUri = `${siteOrigin}${cspReportPath}`;

export type HeaderRecord = Record<string, string>;

export const trustedTypesExempt = (pathname: string): boolean => pathname.replace(/\/+$/, '') === '/contact';

export function headersToRecord(headers: Headers): HeaderRecord {
  const record: HeaderRecord = {};
  headers.forEach((value, name) => {
    record[name.toLowerCase()] = value;
  });
  return record;
}

// The policy public/_headers gives every route once bin/build-csp.ts fills in the hashes.
// Trusted Types is report-only on the contact form because Turnstile's script trips it.
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

// HSTS is a Cloudflare zone setting, so only a production probe can assert it.
export function hstsFindings(headers: HeaderRecord): string[] {
  const value = headers['strict-transport-security'] ?? '';
  return /includesubdomains/i.test(value) ? [] : [`strict-transport-security is ${value || '<missing>'}, expected includeSubDomains`];
}

// An inline script or style missing from the policy runs unthemed or unstyled, and no status code notices.
// Every inline one needs its hash in the header, and the build-time marker must not reach the response.
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

// The contact function refuses a missing or invalid Turnstile token with 400 before the honeypot and the D1 write.
export function contactRefusalFindings(status: number, payload: unknown): string[] {
  const findings: string[] = [];
  const body: { ok?: unknown; error?: unknown } = payload && typeof payload === 'object' ? payload : {};
  if (status !== 400) findings.push(`status ${status}, expected 400`);
  if (body.ok !== false) findings.push('payload does not carry ok: false');
  if (!/verification/i.test(typeof body.error === 'string' ? body.error : '')) findings.push('error does not name the verification challenge');
  return findings;
}
