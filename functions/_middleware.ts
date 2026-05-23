// Cloudflare Pages middleware.
//
// For HTML responses, generate a per-request CSP nonce, attach it to every
// script tag in the document, and replace the static CSP header with the
// nonce-bearing version. Cloudflare JavaScript Detections parses nonce-based
// CSP headers and applies the nonce to its own injected scripts.

const CSP_HEADER = 'Content-Security-Policy';
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
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${CLOUDFLARE_BEACON_HASH} blob: https://static.cloudflareinsights.com https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://cloudflareinsights.com https://challenges.cloudflare.com",
    "frame-src 'self' https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    'upgrade-insecure-requests',
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

  return new Response(transformed.body, {
    status: transformed.status,
    statusText: transformed.statusText,
    headers,
  });
}
