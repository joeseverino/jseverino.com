// The REST core the bin/ scripts' API clients (Cloudflare, GitHub) share: a bearer token, JSON
// bodies, and an error that names the call by a label the provider chooses, so a token or a
// resolved id never reaches output. Every request times out, so an API that stops answering
// fails the run with the call named, before the CI job reaches its own limit.

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

// What every provider's createClient takes.
export interface ClientOptions {
  token: string | undefined;
  // Read at each request when omitted, so a test can stand in for the global.
  fetch?: Fetch | undefined;
}

export interface RestOptions<ErrorBody> extends ClientOptions {
  // The error a missing token raises: where this provider's token comes from.
  noToken: string;
  // Headers the provider adds to every request.
  headers?: Record<string, string>;
  // The error detail in a failed response's body, read in the provider's documented error shape.
  // A body that is not JSON reads as empty, so every field may be missing.
  detail: (payload: Partial<ErrorBody>) => string | undefined;
}

export type Send = (method: string, url: string, label: string, body?: unknown) => Promise<Response>;

// A response's JSON body, or undefined when it has none (a 204, an empty 200).
export async function jsonBody<T>(response: Response): Promise<T | undefined> {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : undefined;
}

// The token only ever goes into the Authorization header; nothing here formats a request's headers into output.
export function createSend<ErrorBody>({ token, noToken, headers = {}, fetch, detail }: RestOptions<ErrorBody>): Send {
  if (!token) throw new Error(noToken);
  return async (method, url, label, body) => {
    const response = await (fetch ?? globalThis.fetch)(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const payload = await jsonBody<Partial<ErrorBody>>(response).catch(() => undefined);
      throw new RestError(method, label, response.status, detail(payload ?? {}));
    }
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
