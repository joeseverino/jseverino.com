// Access service-token headers for the Worker's preview URLs, sent only to hosts of the form
// <one label><PREVIEW_HOST_SUFFIX>.
import { PREVIEW_HOST_SUFFIX } from '../../src/lib/site-config.ts';

export const ACCESS_ID_ENV = 'CF_ACCESS_CLIENT_ID';
export const ACCESS_SECRET_ENV = 'CF_ACCESS_CLIENT_SECRET';

export function isPreviewDeployment(target: string, suffix = PREVIEW_HOST_SUFFIX): boolean {
  const { protocol, hostname } = new URL(target);
  if (protocol !== 'https:' || !hostname.endsWith(suffix)) return false;
  return /^[a-z0-9-]+$/.test(hostname.slice(0, -suffix.length));
}

export function accessHeaders(target: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const id = env[ACCESS_ID_ENV];
  const secret = env[ACCESS_SECRET_ENV];
  if (!id || !secret || !isPreviewDeployment(target)) return {};
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret };
}

// A redirect to the Access login means the request carried no valid token.
export function isAccessChallenge(response: Response): boolean {
  if (response.status < 300 || response.status >= 400) return false;
  const location = response.headers.get('location') ?? '';
  return /\.cloudflareaccess\.com\//.test(location);
}
