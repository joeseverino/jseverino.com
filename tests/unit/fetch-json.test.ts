import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fetchJson } from '../../src/lib/fetch-json.ts';

test('JSON requests handle errors and time out stalled headers and bodies', async () => {
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
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.deepEqual(await fetchJson(base), { ok: true });
    await assert.rejects(fetchJson(`${base}/error`), /HTTP 503/);
    for (const route of ['/headers', '/body']) {
      await assert.rejects(fetchJson(`${base}${route}`, {}, 50), (error: Error) =>
        ['TimeoutError', 'AbortError'].includes(error.name));
    }
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fetchJson(base, { signal: controller.signal }), { name: 'AbortError' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
