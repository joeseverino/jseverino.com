// sitedrift's preview review proxy (/__sitedrift/dev|live/*), narrowed:
//
//   - inert outside a preview: production builds carry no sitedrift config,
//     and the production host never answers, so both return 404;
//   - only content-negotiation headers reach the upstream, never cookies,
//     authorization, or Access/client-identity headers;
//   - responses get the static security headers back (sitedrift strips the
//     framing ones so the viewer can embed LIVE, and the frame is same-origin
//     here), and its injected frame bridge gets the CSP nonce placeholder.

import { onRequest as sitedrift } from 'sitedrift/cloudflare';
import {
  type Context,
  RestampHandler,
  SECURITY_HEADERS,
  forwardedRequest,
  isProductionHost,
  notFound,
  stampBridge,
} from '../lib/sitedrift-preview.ts';

export async function onRequest(context: Context): Promise<Response> {
  const url = new URL(context.request.url);
  if (isProductionHost(url.hostname)) return notFound();
  const config = await context.env.ASSETS.fetch(new URL('/__sitedrift/config.json', url));
  if (!config.ok) return notFound();

  const upstream = await sitedrift({ ...context, request: forwardedRequest(context.request) });
  const headers = new Headers(upstream.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  const init = { status: upstream.status, statusText: upstream.statusText, headers };

  const isHtml = (headers.get('Content-Type') ?? '').toLowerCase().includes('text/html');
  if (!isHtml || !upstream.body) return new Response(upstream.body, init);
  const stamped = new Response(stampBridge(await upstream.text()), init);
  if (!url.pathname.startsWith('/__sitedrift/live')) return stamped;
  const handler = new RestampHandler();
  return new HTMLRewriter().on('script[nonce]', handler).on('style[nonce]', handler).transform(stamped);
}
