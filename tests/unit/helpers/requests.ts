export const postRequest = (url: string, body: unknown, headers: Record<string, string>): Request =>
  new Request(url, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

// A POST whose body is a stream. Node's Request needs `duplex: 'half'` for
// one, which its RequestInit type does not declare.
export const streamRequest = (body: ReadableStream, headers: Record<string, string> = {}): Request =>
  new Request('https://example.test/', { method: 'POST', body, headers, duplex: 'half' } as RequestInit);
