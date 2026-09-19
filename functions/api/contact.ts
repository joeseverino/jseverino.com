// Cloudflare Pages Function — POST /api/contact
//
// Verifies the Turnstile token and stores the submission in Cloudflare D1.
// Email notifications are intentionally not wired up — submissions are reviewed
// in Severino HQ. See the contact-form runbook in the vault for how to add
// Resend later if an inbox ping is ever wanted.
//
// Bundled by the Cloudflare Pages pipeline; this directory is excluded from
// `astro check` (see tsconfig.json).

import {
  CONTACT_PROPERTIES,
  CONTACT_RUNTIME,
  validateContactPayload,
} from '../lib/contact-contract.ts';
import type { D1Database } from '../lib/database.ts';
import { readRequestJson, requestMediaType } from '../lib/request-json.ts';

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

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
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

async function verifyTurnstile(token: string, ip: string, secret: string): Promise<boolean> {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(CONTACT_RUNTIME.turnstileTimeoutMs),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

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

  // Honeypot — bots fill the hidden "company" field. Pretend success, store nothing.
  if (company !== '') return json({ ok: true });

  const ip = request.headers.get('CF-Connecting-IP') ?? '';

  if (!(await verifyTurnstile(turnstileToken, ip, env.TURNSTILE_SECRET_KEY))) {
    return json({ ok: false, error: 'Verification failed. Please try again.' }, 400);
  }

  const userAgent = truncate(
    request.headers.get('User-Agent') ?? '',
    CONTACT_RUNTIME.maxUserAgentLength,
  );
  const sourceUrl = truncate(
    submittedSourceUrl || (request.headers.get('Referer') ?? ''),
    CONTACT_PROPERTIES.sourceUrl.maxLength ?? 0,
  );
  const country = truncate(request.headers.get('CF-IPCountry') ?? '', 2);

  try {
    // Light rate limit — Turnstile stops most bots; this caps abuse from one IP.
    if (ip) {
      const recent = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM contact_submissions
         WHERE ip_address = ?1 AND created_at > datetime('now', '-1 hour')`,
      )
        .bind(ip)
        .first<{ n: number }>();
      if (recent && recent.n >= CONTACT_RUNTIME.maxPerIpPerHour) {
        return json({ ok: false, error: 'Too many messages from this network. Please try again later.' }, 429);
      }
    }

    await env.DB.prepare(
      `INSERT INTO contact_submissions
         (name, email, message, ip_address, user_agent, browser, device, country, source_url)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
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
      )
      .run();
  } catch (error) {
    console.error('D1 contact persistence failed', error);
    return json({ ok: false, error: 'Could not save your message. Please try again.' }, 500);
  }

  return json({ ok: true });
}
