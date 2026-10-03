// Cloudflare Pages Function: POST /api/contact
//
// Verifies the Turnstile token and stores the submission in Cloudflare D1.
// No email notification: submissions are read from D1.
//
// Bundled by the Cloudflare Pages pipeline; this directory is excluded from
// `astro check` (see tsconfig.json).

import {
  CONTACT_PROPERTIES,
  CONTACT_RUNTIME,
  validateContactPayload,
} from '../lib/contact-contract.ts';
import type { D1Database } from '../lib/database.ts';
import { requestMeta, truncate } from '../lib/request-meta.ts';
import { readRequestJson, requestMediaType, type PostContext } from '../lib/request-json.ts';
import { siteverifyAccepts, type Siteverify } from '../lib/turnstile.ts';

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function parseBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Unknown';
}

function parseDevice(ua: string): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return 'Unknown';
}

// A token only counts if it was solved on this site, by the contact widget.
async function verifyTurnstile(token: string, ip: string, secret: string): Promise<boolean> {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  body.append('idempotency_key', crypto.randomUUID());

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(CONTACT_RUNTIME.turnstileTimeoutMs),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as Siteverify;
    return siteverifyAccepts(data, secret);
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }: PostContext<Env>): Promise<Response> {

  if (requestMediaType(request) !== 'application/json') {
    return json({ ok: false, error: 'Invalid request.' }, 415);
  }

  const payload = await readRequestJson(request, CONTACT_RUNTIME.maxBodyBytes);
  if (!payload.ok) {
    return json({ ok: false, error: payload.status === 413 ? 'Request is too large.' : 'Invalid request.' }, payload.status);
  }

  const validation = validateContactPayload(payload.value);
  if (!validation.ok) {
    if (validation.reason === 'missing' && validation.field === 'turnstileToken') {
      return json({ ok: false, error: 'Please complete the verification challenge.' }, 400);
    }
    const error = {
      missing: 'Please fill in your name, email, and message.',
      too_long: 'One of the fields is too long.',
      email: 'Please enter a valid email address.',
      uri: 'Invalid request.',
      invalid: 'Invalid request.',
    }[validation.reason];
    return json({ ok: false, error }, 400);
  }
  const { name, email, message, company, sourceUrl: submittedSourceUrl, turnstileToken } = validation.value;

  // Honeypot: bots fill the hidden "company" field. Pretend success, store nothing.
  if (company !== '') return json({ ok: true });

  const { ip, userAgent, country } = requestMeta(request, CONTACT_RUNTIME.maxUserAgentLength);

  if (!(await verifyTurnstile(turnstileToken, ip, env.TURNSTILE_SECRET_KEY))) {
    return json({ ok: false, error: 'Verification failed. Please try again.' }, 400);
  }

  const sourceUrl = truncate(
    submittedSourceUrl || (request.headers.get('Referer') ?? ''),
    CONTACT_PROPERTIES.sourceUrl.maxLength ?? 0,
  );

  try {
    // Turnstile stops most bots; this caps what one IP can store.
    // The cap is checked inside the INSERT, so concurrent requests cannot race past it.
    const result = await env.DB.prepare(
      `INSERT INTO contact_submissions
         (name, email, message, ip_address, user_agent, browser, device, country, source_url)
       SELECT * FROM (VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9))
       WHERE ?4 IS NULL
          OR (SELECT COUNT(*) FROM contact_submissions
              WHERE ip_address = ?4 AND created_at > datetime('now', '-1 hour')) < ?10`,
    )
      .bind(
        name,
        email,
        message,
        ip || null,
        userAgent || null,
        parseBrowser(userAgent),
        parseDevice(userAgent),
        country || null,
        sourceUrl || null,
        CONTACT_RUNTIME.maxPerIpPerHour,
      )
      .run();
    if (result.meta.changes === 0) {
      return json({ ok: false, error: 'Too many messages from this network. Please try again later.' }, 429);
    }
  } catch (error) {
    console.error('D1 contact persistence failed', error);
    return json({ ok: false, error: 'Could not save your message. Please try again.' }, 500);
  }

  return json({ ok: true });
}
