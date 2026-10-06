// Caller metadata the edge endpoints persist, trimmed and bounded once here.

export function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function asString(value: unknown, max: number): string {
  return typeof value === 'string' ? truncate(value, max) : '';
}

export type RequestMeta = { ip: string; userAgent: string; country: string };

export function requestMeta(request: Request, maxUserAgentLength: number): RequestMeta {
  const header = (name: string, max: number) => truncate(request.headers.get(name) ?? '', max);
  return {
    ip: header('CF-Connecting-IP', 64),
    userAgent: header('User-Agent', maxUserAgentLength),
    country: header('CF-IPCountry', 2),
  };
}

// Where a request came from, as one of this site's own page URLs without query
// or fragment. The submitted value and the Referer are both client input, so a
// candidate counts only when it names this origin; otherwise there is no source.
export function ownPageUrl(origin: string, ...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.origin === origin) return `${origin}${url.pathname}`;
    } catch {
      // Not a URL: try the next candidate.
    }
  }
  return null;
}
