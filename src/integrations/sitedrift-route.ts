// sitedrift's preview proxy, in its Workers form. It 404s on the production host and on builds
// without preview config, and forwards only content-negotiation headers. It serves markup fetched
// at request time, so it builds its CSP per request.

import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createPreviewHandler } from 'sitedrift/cloudflare';
import { randomNonce, withPreviewPolicy } from '../lib/csp.ts';
import { cspReportUri } from '../lib/site-config.ts';

export const ALL: APIRoute = async ({ request }) => {
  const nonce = randomNonce();
  // A copy: sitedrift takes the bindings as an open record, which the generated Env interface is not.
  return withPreviewPolicy(await createPreviewHandler({ nonce }).fetch(request, { ...env }), nonce, cspReportUri);
};
