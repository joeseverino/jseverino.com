// Responses the Worker renders (the API and the preview proxy) get the security headers the assets
// layer gives every static file from public/_headers; a header a route already set is kept.
import { defineMiddleware } from 'astro:middleware';
import headersFile from '../public/_headers?raw';
import { workerHeaders } from './lib/headers-file.ts';

const security = workerHeaders(headersFile);

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  if (context.isPrerendered) return response;
  // A fetched response's headers are immutable, so the headers go on a copy.
  const headers = new Headers(response.headers);
  for (const [name, value] of security) if (!headers.has(name)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
