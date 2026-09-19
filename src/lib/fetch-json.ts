/** Bound build-time requests, including reading the response body. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5_000,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const response = await fetch(url, { ...init, signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json() as Promise<T>;
}
