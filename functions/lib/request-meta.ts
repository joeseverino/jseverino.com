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
