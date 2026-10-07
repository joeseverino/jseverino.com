// The site's CSP. Pages are static, so bin/build-csp.ts hashes the one inline script and one inlined
// stylesheet at build time and writes the policy into _headers. Only the preview proxy builds one per request.

// Build-time marker on a tag the site itself emits: it says "hash me". It is
// spelled as a nonce attribute because the preview wrapper (sitedrift) can only
// write that attribute; bin/build-csp.ts strips it from the output.
export const CSP_INLINE_MARKER = '__CSP_INLINE__';
const MARKER_ATTRIBUTE = new RegExp(`\\s+nonce="${CSP_INLINE_MARKER}"`, 'g');

// Script hosts: Turnstile on the contact page, the Cloudflare Web Analytics beacon.
export const SCRIPT_HOSTS = ['https://challenges.cloudflare.com', 'https://static.cloudflareinsights.com'] as const;

export interface PolicyInput {
  scriptHashes: readonly string[];
  styleHashes: readonly string[];
  reportUri: string;
  // Enforce Trusted Types. The contact page opts out because Turnstile's own
  // script writes to sinks without a policy; there it is only reported.
  trustedTypes: boolean;
  scriptExtras?: readonly string[];
}

export const TRUSTED_TYPES = "require-trusted-types-for 'script'";

const sources = (hashes: readonly string[]): string[] => hashes.map((hash) => `'${hash}'`);

export function htmlPolicy({ scriptHashes, styleHashes, reportUri, trustedTypes, scriptExtras = [] }: PolicyInput): string {
  return [
    "default-src 'none'",
    ['script-src', "'self'", ...sources(scriptHashes), ...scriptExtras, ...SCRIPT_HOSTS].join(' '),
    ...(trustedTypes ? [TRUSTED_TYPES] : []),
    ['style-src', "'self'", ...sources(styleHashes)].join(' '),
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
    `report-uri ${reportUri}`,
  ].join('; ');
}

export const trustedTypesReportOnly = (reportUri: string): string =>
  [TRUSTED_TYPES, 'report-to csp-endpoint', `report-uri ${reportUri}`].join('; ');

export const reportingEndpoints = (reportUri: string): string => `csp-endpoint="${reportUri}"`;

export async function hashSource(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256-${toBase64(new Uint8Array(digest))}`;
}

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

export interface InlineScan {
  html: string;
  scriptHashes: string[];
  styleHashes: string[];
  problems: string[];
}

const BLOCK = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const EXECUTABLE_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript']);
// Same-origin scripts (the bundled /_astro/ modules, the preview bridge) are
// covered by 'self'.
const SAME_ORIGIN = /^\/(?!\/)/;

const attribute = (attributes: string, name: string): string | undefined =>
  new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(` ${attributes}`)?.slice(1).find((value) => value !== undefined);

// Hash the marked inline scripts and styles and report anything the policy would block.
// Unmarked content (raw HTML in a writeup, an injected tag) fails the build.
export async function scanInline(html: string): Promise<InlineScan> {
  const headEnd = html.indexOf('</head>');
  const scriptHashes = new Set<string>();
  const styleHashes = new Set<string>();
  const problems: string[] = [];

  for (const match of html.matchAll(BLOCK)) {
    const [block, tag = '', attributes = '', body = ''] = match;
    const name = tag.toLowerCase();
    const marked = attributes.includes(`nonce="${CSP_INLINE_MARKER}"`);
    const inHead = headEnd !== -1 && (match.index ?? 0) < headEnd;
    const excerpt = block.slice(0, 100);

    if (name === 'script') {
      const src = attribute(attributes, 'src');
      if (src !== undefined) {
        if (!SAME_ORIGIN.test(src) && !SCRIPT_HOSTS.some((host) => src.startsWith(`${host}/`))) {
          problems.push(`script from a source the policy does not allow: ${excerpt}`);
        }
      } else if (EXECUTABLE_TYPES.has((attribute(attributes, 'type') ?? '').toLowerCase())) {
        if (marked) scriptHashes.add(await hashSource(body));
        else problems.push(`inline script the site did not mark: ${excerpt}`);
      }
    } else if (marked || (inHead && attributes.trim() === '')) {
      styleHashes.add(await hashSource(body));
    } else {
      problems.push(`inline style the site did not emit: ${excerpt}`);
    }
  }

  return { html: html.replace(MARKER_ATTRIBUTE, ''), scriptHashes: [...scriptHashes], styleHashes: [...styleHashes], problems };
}

// The same scan for markup fetched at request time, where nothing is marked.
export async function inlineHashes(html: string): Promise<{ scriptHashes: string[]; styleHashes: string[] }> {
  const scriptHashes = new Set<string>();
  const styleHashes = new Set<string>();
  for (const [, tag = '', attributes = '', body = ''] of html.matchAll(BLOCK)) {
    if (tag.toLowerCase() === 'style') styleHashes.add(await hashSource(body));
    else if (attribute(attributes, 'src') === undefined && EXECUTABLE_TYPES.has((attribute(attributes, 'type') ?? '').toLowerCase())) {
      scriptHashes.add(await hashSource(body));
    }
  }
  return { scriptHashes: [...scriptHashes], styleHashes: [...styleHashes] };
}

export const randomNonce = (): string => toBase64(crypto.getRandomValues(new Uint8Array(16)));

// The preview proxy's HTML response with its own policy: `nonce` covers the injected bridge
// script, hashes cover the page's inline tags. Non-HTML passes through.
export async function withPreviewPolicy(response: Response, nonce: string, reportUri: string): Promise<Response> {
  if (!/text\/html/i.test(response.headers.get('Content-Type') ?? '') || response.body === null) return response;
  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', htmlPolicy({ ...(await inlineHashes(body)), reportUri, trustedTypes: false, scriptExtras: [`'nonce-${nonce}'`] }));
  headers.delete('Content-Length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
