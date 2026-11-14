import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { fetchJson } from '../../src/lib/fetch-json.ts';

// /headers never answers, /body sends a header and half a body, /error answers 503.
const server = createServer((req, res) => {
  if (req.url === '/headers') return;
  if (req.url === '/body') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{');
    return;
  }
  res.writeHead(req.url === '/error' ? 503 : 200);
  res.end('{"ok":true}');
});
let base = '';

before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const timedOut = (error: Error) => ['TimeoutError', 'AbortError'].includes(error.name);

test('returns the parsed body of a 200', async () => {
  assert.deepEqual(await fetchJson(base), { ok: true });
});

test('rejects an HTTP error with its status', async () => {
  await assert.rejects(fetchJson(`${base}/error`), /HTTP 503/);
});

test('times out a server that never sends its headers', async () => {
  await assert.rejects(fetchJson(`${base}/headers`, {}, 50), timedOut);
});

test('times out a body that stalls after the headers', async () => {
  await assert.rejects(fetchJson(`${base}/body`, {}, 50), timedOut);
});

test("honors the caller's abort signal", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchJson(base, { signal: controller.signal }), { name: 'AbortError' });
});
