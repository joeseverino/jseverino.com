// sitedrift's preview proxy. 404s on the production host and on builds without preview config,
// and forwards only content-negotiation headers. It serves markup fetched at request time,
// so it builds its CSP per request.
import { createPreviewHandler } from 'sitedrift/cloudflare';
import { SITE } from '../generated/site.ts';
import { randomNonce, withPreviewPolicy } from '../lib/csp.ts';

type Context = Parameters<ReturnType<typeof createPreviewHandler>['onRequest']>[0];

export async function onRequest(context: Context): Promise<Response> {
  const nonce = randomNonce();
  return withPreviewPolicy(await createPreviewHandler({ nonce }).onRequest(context), nonce, SITE.cspReportUri);
}
