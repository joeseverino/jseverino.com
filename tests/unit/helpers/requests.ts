import assert from 'node:assert/strict';

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

// The media-type check both API endpoints make: each accepted type passes in any
// case and with parameters; another type, a longer one, or an accepted type named
// only inside a parameter is refused with 415.
export async function assertMediaTypes(accepted: string[], status: (contentType: string) => Promise<number>, passed: number): Promise<void> {
  for (const mediaType of accepted) {
    for (const contentType of ['text/plain', `${mediaType}p`, `text/plain; note=${mediaType}`]) assert.equal(await status(contentType), 415, contentType);
    assert.equal(await status(`${mediaType.toUpperCase()}; charset=utf-8`), passed, mediaType);
  }
}
