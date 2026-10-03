// A POST to one of the site's endpoints, the way a browser or a reporting
// agent sends it: a string body as-is, anything else as JSON.
export const postRequest = (url: string, body: unknown, headers: Record<string, string>): Request =>
  new Request(url, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
