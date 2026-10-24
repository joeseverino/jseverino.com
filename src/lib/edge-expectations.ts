// Pure checks returning findings (empty means correct). tests/edge runs them against
// the local Worker runtime; bin/deploy-verify.ts runs the same ones against production.
// `headers` is keyed by lower-cased name, as Playwright's response.headers() returns.
// The header and cache values expected are public/_headers' own, so a finding means the edge served
// something other than the file; the CSP clauses below are a policy of their own.
import fs from 'node:fs';
import { CSP_INLINE_MARKER, inlineHashes, TRUSTED_TYPES } from './csp.ts';
import { applyRules, parseHeaders } from './headers-file.ts';
import { cspReportPath, cspReportUri } from './site-config.ts';
import { fromRoot } from './site-root.ts';

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
  for (const clause of ["default-src 'none'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", 'report-to csp-endpoint']) {
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

const headersFile = parseHeaders(fs.readFileSync(fromRoot('public/_headers'), 'utf8'));
// bin/build-csp.ts fills these at build time; cspFindings checks what they become.
const PLACEHOLDER = /^__[A-Z_]+__$/;

// A path rule as a pattern: `*` is a splat, `:name` one segment. Host rules never match a pathname.
const rulePattern = (rule: string): RegExp =>
  new RegExp(
    `^${rule
      .split('*')
      .map((part) => part.split(/:\w+/).map(RegExp.escape).join('[^/]+'))
      .join('.*')}$`,
  );

// What public/_headers gives the static asset at a path.
export const fileHeaders = (pathname: string): Map<string, string> =>
  applyRules([...headersFile].filter(([rule]) => !rule.includes('://') && rulePattern(rule).test(pathname)).map(([, lines]) => lines));

// The site serves nothing for another origin to read, so no response may grant one CORS access.
function headerFindings(headers: HeaderRecord, expected: Map<string, string>, names: Iterable<string>): string[] {
  const findings: string[] = [];
  for (const name of names) {
    const value = expected.get(name) ?? '';
    const received = headers[name];
    if ((received ?? '').toLowerCase() !== value.toLowerCase()) findings.push(`${name} is ${received ?? '<missing>'}, expected ${value}`);
  }
  const cors = headers['access-control-allow-origin'];
  if (cors !== undefined) findings.push(`access-control-allow-origin is ${cors}, expected none`);
  return findings;
}

// The headers the `/*` rule gives every route, less the policy placeholders.
const everyRoute = applyRules([headersFile.get('/*') ?? []]);

export function staticHeaderFindings(headers: HeaderRecord): string[] {
  const names = [...everyRoute].filter(([, value]) => !PLACEHOLDER.test(value)).map(([name]) => name);
  return headerFindings(headers, everyRoute, names);
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
  // The build marker is the only nonce a static page carries; any other was minted where nothing issues one.
  const nonces = [...html.matchAll(/<(?:script|style)\b[^>]*\snonce="([^"]*)"/gi)].map((match) => match[1]);
  if (nonces.some((nonce) => nonce !== CSP_INLINE_MARKER)) findings.push(`a script or style tag carries a nonce other than ${CSP_INLINE_MARKER}`);
  return findings;
}

// The Cache-Control public/_headers gives the asset at `pathname`.
export function cacheRuleFindings(headers: HeaderRecord, pathname: string): string[] {
  const expected = fileHeaders(pathname);
  if (!expected.has('cache-control')) return [`public/_headers gives ${pathname} no Cache-Control`];
  return headerFindings(headers, expected, ['cache-control']);
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
