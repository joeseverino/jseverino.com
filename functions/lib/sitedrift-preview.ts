// Helpers for the sitedrift preview proxy route (functions/__sitedrift/[[path]].ts).

import { SITE } from '../generated/site.ts';
import { CSP_NONCE_ATTRIBUTE, CSP_NONCE_PLACEHOLDER } from './csp-nonce.ts';

export interface Env {
  ASSETS: { fetch(input: Request | URL | string): Promise<Response> };
}

export type Context = { request: Request; env: Env; next(): Promise<Response> };

const FORWARDED_HEADERS = ['accept', 'accept-language', 'cache-control', 'if-modified-since', 'if-none-match', 'range', 'user-agent'];

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
};

export const notFound = () => new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export function isProductionHost(hostname: string): boolean {
  return hostname === SITE.domain || hostname === `www.${SITE.domain}`;
}

export function forwardedRequest(request: Request): Request {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Request(request.url, { method: request.method, headers, redirect: 'manual' });
}

// sitedrift injects its frame bridge as a bare <script> ending exactly at the
// first </head> (or opening a document without one). Only that span is
// stamped; anything else leaves the page as it is and the bridge un-nonced.
export function stampBridge(html: string): string {
  const head = html.indexOf('</head>');
  const start = head === -1 ? 0 : html.lastIndexOf('<script>', head);
  if (start === -1 || !html.startsWith('<script>', start)) return html;
  const end = head === -1 ? html.indexOf('</script>') + '</script>'.length : head;
  if (!html.slice(start, end).endsWith('</script>')) return html;
  const inner = html.slice(start + '<script>'.length, end - '</script>'.length);
  if (/<\/?script/i.test(inner)) return html;
  return `${html.slice(0, start)}<script ${CSP_NONCE_ATTRIBUTE}>${html.slice(start + '<script>'.length)}`;
}

// A LIVE page arrives with the nonce production issued on exactly the tags its
// build stamped; put the placeholder back so the preview's nonce replaces it.
// DEV pages still carry the placeholder from this build.
export class RestampHandler {
  element(element: { setAttribute(name: string, value: string): void }): void {
    element.setAttribute('nonce', CSP_NONCE_PLACEHOLDER);
  }
}
