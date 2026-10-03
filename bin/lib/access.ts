// Cloudflare Access service-token headers for requests to this project's Pages
// deployments, which sit behind the preview access policy. Sent only to the
// project's pages.dev host and its deployment subdomains.
import { PAGES_HOST } from '../../src/lib/site-config.ts';

export const ACCESS_ID_ENV = 'CF_ACCESS_CLIENT_ID';
export const ACCESS_SECRET_ENV = 'CF_ACCESS_CLIENT_SECRET';

export function isPagesDeployment(target: string, host = PAGES_HOST): boolean {
  const url = new URL(target);
  if (url.protocol !== 'https:') return false;
  return url.hostname === host || (url.hostname.endsWith(`.${host}`) && !url.hostname.slice(0, -host.length - 1).includes('.'));
}

export function accessHeaders(target: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const id = env[ACCESS_ID_ENV];
  const secret = env[ACCESS_SECRET_ENV];
  if (!id || !secret) return {};
  if (!isPagesDeployment(target)) return {};
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret };
}

// A redirect to the Access login means the request carried no valid token.
export function isAccessChallenge(response: Response): boolean {
  if (response.status < 300 || response.status >= 400) return false;
  const location = response.headers.get('location') ?? '';
  return /\.cloudflareaccess\.com\//.test(location);
}
