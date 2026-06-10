// Cloudflare Pages middleware.
//
// For HTML responses, generate a per-request CSP nonce, attach it to every
// script tag in the document, and replace the static CSP header with the
// nonce-bearing version. Cloudflare JavaScript Detections parses nonce-based
// CSP headers and applies the nonce to its own injected scripts.

const CSP_HEADER = 'Content-Security-Policy';
const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';
const REPORTING_ENDPOINTS_HEADER = 'Reporting-Endpoints';
const CSP_REPORT_ENDPOINT = 'https://jseverino.com/api/csp-report';
const CLOUDFLARE_BEACON_HASH =
  "'sha512-57MDmcccJXYtNnH+ZiBwzC4jb2rvgVCEokYN+L/nLlmO8rfYT/gIpW2A569iJ/3b+0UEasghjuZH/ma3wIs/EQ=='";

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function csp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' ${CLOUDFLARE_BEACON_HASH} blob: https://static.cloudflareinsights.com https://challenges.cloudflare.com`,
    "style-src 'self'",
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
    `report-uri ${CSP_REPORT_ENDPOINT}`,
  ].join('; ');
}

// Report-only companion policy. Carries Trusted Types so first-party
// regressions still surface via /api/csp-report. Enforcement is blocked
// by Cloudflare-injected scripts (JS Detections at /cdn-cgi/challenge-
// platform/scripts/jsd/main.js, plus the cdn-cgi/rum beacon) that
// assign to innerHTML and aren't TT-compliant. Disabling those would
// lose Cloudflare's bot-scoring and real-user telemetry, which the
// site relies on. Reassess if Cloudflare ships TT-compliant versions.
function cspReportOnly(): string {
  return [
    "require-trusted-types-for 'script'",
    'report-to csp-endpoint',
    `report-uri ${CSP_REPORT_ENDPOINT}`,
  ].join('; ');
}

// No TS parameter properties here: the unit suite imports this file under
// Node's type stripping, which only erases types and cannot transform them.
class ScriptNonceHandler {
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
  const transformed = new HTMLRewriter()
    .on('script', new ScriptNonceHandler(nonce))
    .transform(response);

  // HTMLRewriter decompresses the body, so we must remove headers that
  // describe the original (possibly compressed) payload.
  const headers = new Headers(transformed.headers);
  headers.set(CSP_HEADER, csp(nonce));
  headers.set(CSP_REPORT_ONLY_HEADER, cspReportOnly());
  headers.set(REPORTING_ENDPOINTS_HEADER, `csp-endpoint="${CSP_REPORT_ENDPOINT}"`);
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');

  return new Response(transformed.body, {
    status: transformed.status,
    statusText: transformed.statusText,
    headers,
  });
}
