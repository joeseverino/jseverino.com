// The REST core the bin/ scripts' API clients (Cloudflare, GitHub) share: a bearer token, JSON
// bodies, a timeout on every request, and an error that names the call by a label the provider
// chooses, so a token or a resolved id never reaches output.

// What the clients need from fetch: a URL string and an init.
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 30_000;

export class RestError extends Error {
  readonly status: number;

  constructor(method: string, label: string, status: number, detail = '') {
    super(`${method} ${label} → ${status}${detail ? ` (${detail})` : ''}`);
    this.status = status;
  }
}

export interface RestOptions {
  token: string;
  // Headers the provider adds to every request.
  headers?: Record<string, string>;
  // Read at each request when omitted, so a test can stand in for the global.
  fetch?: Fetch | undefined;
  // The error detail in a failed response's body, in the provider's shape.
  detail: (payload: unknown) => string | undefined;
}

export type Send = (method: string, url: string, label: string, body?: unknown) => Promise<Response>;

// The token only ever goes into the Authorization header; nothing here formats a request's headers into output.
export function createSend({ token, headers = {}, fetch, detail }: RestOptions): Send {
  return async (method, url, label, body) => {
    const response = await (fetch ?? globalThis.fetch)(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new RestError(method, label, response.status, detail(await response.json().catch(() => ({}))));
    return response;
  };
}

// A resource that answers 404 reads as absent.
export async function absentOn404<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof RestError && error.status === 404) return null;
    throw error;
  }
}
