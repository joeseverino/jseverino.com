// Cloudflare Pages middleware.
//
// For HTML responses, generate a per-request CSP nonce, swap it in for the
// build-time placeholder on the script and style tags the site emits, and set
// the nonce-bearing CSP. Tags without the placeholder keep no nonce, so markup
// that reaches a page from content cannot run. Cloudflare JavaScript
// Detections and the Web Analytics beacon are injected after this runs; both
// pick up the nonce from the header, and the beacon's host is allowlisted too.

import { SITE } from './generated/site.ts';
import { CSP_NONCE_PLACEHOLDER } from './lib/csp-nonce.ts';

const CSP_HEADER = 'Content-Security-Policy';
const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';
const REPORTING_ENDPOINTS_HEADER = 'Reporting-Endpoints';

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// blob: stays in script-src for the blob scripts Cloudflare JavaScript
// Detections loads; drop it once the report-only policy (which omits it)
// shows no blob violations in /api/csp-report.
function csp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' blob: https://static.cloudflareinsights.com https://challenges.cloudflare.com`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://cloudflareinsights.com https://challenges.cloudflare.com",
    "frame-src 'self' https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    'upgrade-insecure-requests',
    'report-to csp-endpoint',
    // Browsers without Reporting API support for CSP (Firefox) use this;
    // the rest ignore it when report-to is present.
    `report-uri ${SITE.cspReportUri}`,
  ].join('; ');
}

// Report-only companion policy: what the enforced policy will become once
// /api/csp-report shows it blocks nothing real.
//
// 'strict-dynamic' drops the host allowlist in favor of nonce propagation:
// every script the page itself emits is nonced by the middleware, and
// whatever those scripts load inherits trust, so 'self' and the Cloudflare
// hosts stop mattering. It stays report-only until the D1 log confirms the
// Cloudflare-injected scripts and Turnstile survive it.
//
// Trusted Types is blocked by Cloudflare-injected scripts (JS Detections at
// /cdn-cgi/challenge-platform/scripts/jsd/main.js, plus the cdn-cgi/rum
// beacon) that assign to innerHTML and aren't TT-compliant. Disabling those
// would lose Cloudflare's bot-scoring and real-user telemetry, which the site
// relies on. Reassess if Cloudflare ships TT-compliant versions.
function cspReportOnly(nonce: string): string {
  return [
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    "require-trusted-types-for 'script'",
    'report-to csp-endpoint',
    `report-uri ${SITE.cspReportUri}`,
  ].join('; ');
}

// No TS parameter properties here: the unit suite imports this file under
// Node's type stripping, which only erases types and cannot transform them.
class NonceHandler {
  private readonly nonce: string;

  constructor(nonce: string) {
    this.nonce = nonce;
  }

  element(element: { setAttribute(name: string, value: string): void }): void {
    element.setAttribute('nonce', this.nonce);
  }
}

export async function onRequest(context: { next(): Promise<Response> }): Promise<Response> {
  const response = await context.next();
  const contentType = response.headers.get('Content-Type') ?? '';

  // Skip transformation if:
  // 1. Not an HTML response.
  // 2. Response has no body (304 Not Modified, 204 No Content).
  if (
    !contentType.toLowerCase().includes('text/html') ||
    response.status === 304 ||
    response.status === 204
  ) {
    return response;
  }

  const nonce = createNonce();
  const handler = new NonceHandler(nonce);
  const placeholder = `[nonce="${CSP_NONCE_PLACEHOLDER}"]`;
  const transformed = new HTMLRewriter()
    .on(`script${placeholder}`, handler)
    .on(`style${placeholder}`, handler)
    .transform(response);

  // HTMLRewriter decompresses the body, so we must remove headers that
  // describe the original (possibly compressed) payload.
  const headers = new Headers(transformed.headers);
  headers.set(CSP_HEADER, csp(nonce));
  headers.set(CSP_REPORT_ONLY_HEADER, cspReportOnly(nonce));
  headers.set(REPORTING_ENDPOINTS_HEADER, `csp-endpoint="${SITE.cspReportUri}"`);
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');

  return new Response(transformed.body, {
    status: transformed.status,
    statusText: transformed.statusText,
    headers,
  });
}
