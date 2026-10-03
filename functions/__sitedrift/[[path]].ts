// sitedrift's preview review proxy (/__sitedrift/dev|live/*). Its defaults are
// the guards this route needs: 404 on the production host and on any build
// without the preview config, only content-negotiation headers forwarded to
// production, security headers restored, and the nonce placeholder on every
// tag it writes.
export { onRequest } from 'sitedrift/cloudflare';
