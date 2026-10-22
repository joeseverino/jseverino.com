// sitedrift's preview proxy, in its Workers form. It 404s on the production host and on builds
// without preview config, and forwards only content-negotiation headers. It serves markup fetched
// at request time, so it builds its CSP per request.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createPreviewHandler } from 'sitedrift/cloudflare';
import { cspReportUri } from '../lib/site-config.ts';
import { randomNonce, withPreviewPolicy } from '../lib/csp.ts';

export const ALL: APIRoute = async ({ request }) => {
  const nonce = randomNonce();
  // A copy: sitedrift takes the bindings as an open record, which the generated Env interface is not.
  return withPreviewPolicy(await createPreviewHandler({ nonce }).fetch(request, { ...env }), nonce, cspReportUri);
};
