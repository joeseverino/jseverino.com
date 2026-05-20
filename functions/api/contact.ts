// Cloudflare Pages Function — POST /api/contact
//
// Verifies the Turnstile token and stores the submission in Cloudflare D1.
// Email notifications are intentionally not wired up — submissions are reviewed
// in Severino HQ. See the contact-form runbook in the vault for how to add
// Resend later if an inbox ping is ever wanted.
//
// Bundled by the Cloudflare Pages pipeline; this directory is excluded from
// `astro check` (see tsconfig.json).

interface D1Result {
  success: boolean;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
}

interface ContactPayload {
  name?: unknown;
  email?: unknown;
  message?: unknown;
  company?: unknown; // honeypot
  sourceUrl?: unknown;
  turnstileToken?: unknown;
}

const MAX_PER_IP_PER_HOUR = 5;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

  let payload: ContactPayload;
  try {
    payload = (await request.json()) as ContactPayload;
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  // Honeypot — bots fill the hidden "company" field. Pretend success, store nothing.
  if (asString(payload.company) !== '') {
    return json({ ok: true });
  }

  const name = asString(payload.name);
  const email = asString(payload.email);
  const message = asString(payload.message);
  const turnstileToken = asString(payload.turnstileToken);

  if (!name || !email || !message) {
    return json({ ok: false, error: 'Please fill in your name, email, and message.' }, 400);
  }
  if (name.length > 190 || email.length > 190 || message.length > 5000) {
    return json({ ok: false, error: 'One of the fields is too long.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }
  if (!turnstileToken) {
    return json({ ok: false, error: 'Please complete the verification challenge.' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? '';

  if (!(await verifyTurnstile(turnstileToken, ip, env.TURNSTILE_SECRET_KEY))) {
    return json({ ok: false, error: 'Verification failed. Please try again.' }, 400);
  }

  // Light rate limit — Turnstile stops most bots; this caps abuse from one IP.
  if (ip) {
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM contact_submissions
       WHERE ip_address = ?1 AND created_at > datetime('now', '-1 hour')`,
    )
      .bind(ip)
      .first<{ n: number }>();
    if (recent && recent.n >= MAX_PER_IP_PER_HOUR) {
      return json({ ok: false, error: 'Too many messages from this network. Please try again later.' }, 429);
    }
  }

  const userAgent = request.headers.get('User-Agent') ?? '';
  const sourceUrl = asString(payload.sourceUrl) || (request.headers.get('Referer') ?? '');

  try {
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
        request.headers.get('CF-IPCountry') || null,
        sourceUrl || null,
      )
      .run();
  } catch (error) {
    console.error('D1 insert failed', error);
    return json({ ok: false, error: 'Could not save your message. Please try again.' }, 500);
  }

  return json({ ok: true });
}
