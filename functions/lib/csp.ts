// The site's Content Security Policy, built from the page markup itself.
//
// Every page is a static file, so the one inline script (the theme bootstrap)
// and the one inlined stylesheet are known at build time: bin/build-csp.ts
// hashes them and writes the policy into the built _headers. Nothing is
// computed per request, so a page view never invokes a Function.
//
// Only the preview proxy (functions/__sitedrift) builds a policy at request
// time, because it serves markup fetched while the request runs.

// Build-time marker on a tag the site itself emits: it says "hash me". It is
// spelled as a nonce attribute because the preview wrapper (sitedrift) can only
// write that attribute; bin/build-csp.ts strips it from the output.
export const CSP_INLINE_MARKER = '__CSP_INLINE__';
const MARKER_ATTRIBUTE = new RegExp(`\\s+nonce="${CSP_INLINE_MARKER}"`, 'g');

// Hosts a page may load a script from. Turnstile is loaded on the contact page;
// the Web Analytics beacon is injected by Cloudflare.
export const SCRIPT_HOSTS = ['https://challenges.cloudflare.com', 'https://static.cloudflareinsights.com'] as const;

export interface PolicyInput {
  scriptHashes: readonly string[];
  styleHashes: readonly string[];
  reportUri: string;
  // Enforce Trusted Types. The contact page opts out because Turnstile's own
  // script writes to sinks without a policy; there it is only reported.
  trustedTypes: boolean;
  // Extra script sources, for the preview proxy's per-request nonce.
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

// The report-only companion the contact page carries instead of enforcing
// Trusted Types.
export const trustedTypesReportOnly = (reportUri: string): string =>
  [TRUSTED_TYPES, 'report-to csp-endpoint', `report-uri ${reportUri}`].join('; ');

export const reportingEndpoints = (reportUri: string): string => `csp-endpoint="${reportUri}"`;

// A CSP hash source ('sha256-…', quotes added by the caller) over a script or
// style body, exactly as it sits between its tags.
export async function hashSource(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256-${toBase64(new Uint8Array(digest))}`;
}

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

export interface InlineScan {
  // The page with the build-time marker removed.
  html: string;
  scriptHashes: string[];
  styleHashes: string[];
  // Anything on the page the policy would not cover.
  problems: string[];
}

const BLOCK = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const EXECUTABLE_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript']);
// Same-origin scripts (the bundled /_astro/ modules, the preview bridge) are
// covered by 'self'.
const SAME_ORIGIN = /^\/(?!\/)/;

const attribute = (attributes: string, name: string): string | undefined =>
  new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(` ${attributes}`)?.slice(1).find((value) => value !== undefined);

// Hash the inline scripts and styles the site marked, and report every script
// or style the policy would block. Content that reaches a page unmarked (raw
// HTML in a writeup, an injected tag) is a build failure, not a silent block.
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

// The same scan for markup fetched at request time, where nothing is marked:
// every inline script and style on the page is covered by its own hash.
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

// The preview proxy's HTML response with its own policy: `nonce` covers the
// bridge script the proxy injects, and each inline script and style of the
// fetched page is covered by its hash. Anything else, and anything that is not
// HTML, passes through.
export async function withPreviewPolicy(response: Response, nonce: string, reportUri: string): Promise<Response> {
  if (!/text\/html/i.test(response.headers.get('Content-Type') ?? '') || response.body === null) return response;
  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', htmlPolicy({ ...(await inlineHashes(body)), reportUri, trustedTypes: false, scriptExtras: [`'nonce-${nonce}'`] }));
  headers.delete('Content-Length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
