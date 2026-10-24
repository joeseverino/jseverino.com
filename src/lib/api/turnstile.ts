// Turnstile for the contact function: the siteverify call and which answers it accepts.
import { TURNSTILE_ORIGIN } from '../csp.ts';
import { SITE } from '../site-config.ts';
import { CONTACT_RUNTIME } from './contact-contract.ts';

// The widget script the contact page loads, and the API that checks the token it yields.
export const TURNSTILE_SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js`;
const SITEVERIFY_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`;

type Siteverify = { success?: boolean; hostname?: string; action?: string };

// Cloudflare's published Turnstile test secrets (pass, fail, token spent). Siteverify answers
// them with documented test values, so a local run can submit. Only these exact
// keys relax the check.
export const TURNSTILE_TEST_SECRETS: ReadonlySet<string> = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);
const TEST_SITEVERIFY = { hostnames: ['localhost', SITE.domain], actions: ['test', CONTACT_RUNTIME.turnstileAction] };

export function siteverifyAccepts(data: Siteverify, secret: string): boolean {
  if (data.success !== true) return false;
  if (TURNSTILE_TEST_SECRETS.has(secret)) {
    return TEST_SITEVERIFY.hostnames.includes(data.hostname ?? '') && TEST_SITEVERIFY.actions.includes(data.action ?? '');
  }
  return data.hostname === SITE.domain && data.action === CONTACT_RUNTIME.turnstileAction;
}

// A token only counts if it was solved on this site, by the contact widget.
export async function verifyTurnstile(token: string, ip: string, secret: string): Promise<boolean> {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  body.append('idempotency_key', crypto.randomUUID());

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(CONTACT_RUNTIME.turnstileTimeoutMs),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as Siteverify;
    return siteverifyAccepts(data, secret);
  } catch {
    return false;
  }
}
