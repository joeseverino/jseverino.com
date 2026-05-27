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

// Report-only companion policy. Carries Trusted Types directives that are
// not yet enforced: violations are surfaced via the same /api/csp-report
// endpoint with disposition="report". Promote into csp() once reports stay
// clean for a few days. See SECURITY.md and the modernization backlog for
// the promotion criteria.
function cspReportOnly(): string {
  return [
    "require-trusted-types-for 'script'",
    'report-to csp-endpoint',
    `report-uri ${CSP_REPORT_ENDPOINT}`,
  ].join('; ');
}

class ScriptNonceHandler {
  constructor(private readonly nonce: string) {}

  element(element: { setAttribute(name: string, value: string): void }): void {
    element.setAttribute('nonce', this.nonce);
  }
}

export async function onRequest(context: { next(): Promise<Response> }): Promise<Response> {
  const response = await context.next();
  const contentType = response.headers.get('Content-Type') ?? '';

  if (!contentType.toLowerCase().includes('text/html')) {
    return response;
  }

  const nonce = createNonce();
  const transformed = new HTMLRewriter()
    .on('script', new ScriptNonceHandler(nonce))
    .transform(response);

  const headers = new Headers(transformed.headers);
  headers.set(CSP_HEADER, csp(nonce));
  headers.set(CSP_REPORT_ONLY_HEADER, cspReportOnly());
  headers.set(REPORTING_ENDPOINTS_HEADER, `csp-endpoint="${CSP_REPORT_ENDPOINT}"`);

  return new Response(transformed.body, {
    status: transformed.status,
    statusText: transformed.statusText,
    headers,
  });
}
