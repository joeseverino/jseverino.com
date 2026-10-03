// Which Turnstile siteverify answers the contact function accepts.
import { SITE } from '../generated/site.ts';
import { CONTACT_RUNTIME } from './contact-contract.ts';

export type Siteverify = { success?: boolean; hostname?: string; action?: string };

// Cloudflare's published Turnstile test secrets (pass, fail, token spent).
// Siteverify answers them for any token with its documented test values
// (hostname localhost, action test), so a local `wrangler pages dev` with the
// secret from .env.example can submit. Only these exact keys relax the
// check; the production secret never matches one.
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

