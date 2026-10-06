// sitedrift's preview review proxy (/__sitedrift/dev|live/*). Its defaults are
// the guards this route needs: 404 on the production host and on any build
// without the preview config, and only content-negotiation headers forwarded to
// production. It is the one route that serves markup fetched while the request
// runs, so it builds its Content Security Policy per request (withPreviewPolicy).
import { createPreviewHandler } from 'sitedrift/cloudflare';
import { SITE } from '../generated/site.ts';
import { randomNonce, withPreviewPolicy } from '../lib/csp.ts';

type Context = Parameters<ReturnType<typeof createPreviewHandler>['onRequest']>[0];

export async function onRequest(context: Context): Promise<Response> {
  const nonce = randomNonce();
  return withPreviewPolicy(await createPreviewHandler({ nonce }).onRequest(context), nonce, SITE.cspReportUri);
}
