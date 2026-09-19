import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRequestJson } from '../../functions/lib/request-json.ts';

function streamedRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[reads++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const init = { method: 'POST', body, headers, duplex: 'half' };
  return {
    request: new Request('https://example.test/', init),
    stats: () => ({ reads, cancelled, locked: body.locked }),
  };
}

const encode = (value: string) => new TextEncoder().encode(value);

test('accepts an exact byte limit and UTF-8 characters split across chunks', async () => {
  const bytes = encode('{"text":"€🌍"}');
  const { request, stats } = streamedRequest([...bytes].map((byte) => Uint8Array.of(byte)));
  assert.deepEqual(await readRequestJson(request, bytes.byteLength), { ok: true, value: { text: '€🌍' } });
  assert.equal(stats().locked, false);
});

const lengthHeaders: Record<string, string>[] = [{}, { 'Content-Length': '1' }, { 'Content-Length': 'invalid' }];
for (const headers of lengthHeaders) {
  test(`stops oversized streams regardless of Content-Length ${JSON.stringify(headers)}`, async () => {
    const { request, stats } = streamedRequest([encode('1234'), encode('5678'), encode('never read')], headers);
    assert.deepEqual(await readRequestJson(request, 6), { ok: false, status: 413 });
    assert.deepEqual(stats(), { reads: 2, cancelled: true, locked: false });
  });
}

test('rejects an oversized declared length without reading the body', async () => {
  const { request, stats } = streamedRequest([encode('{}')], { 'Content-Length': '100' });
  assert.deepEqual(await readRequestJson(request, 10), { ok: false, status: 413 });
  assert.deepEqual(stats(), { reads: 0, cancelled: true, locked: false });
});

test('does not wait on a cancelled sender to finish rejecting an oversized stream', async () => {
  const body = new ReadableStream({
    start(controller) { controller.enqueue(encode('too big')); },
    cancel() { return new Promise(() => {}); },
  });
  const request = new Request('https://example.test/', { method: 'POST', body, duplex: 'half' } as RequestInit);
  assert.deepEqual(await readRequestJson(request, 2), { ok: false, status: 413 });
  assert.equal(body.locked, false);
});

test('rejects malformed JSON, malformed UTF-8, and missing bodies', async () => {
  for (const bytes of [encode('{'), Uint8Array.of(34, 255, 34)]) {
    const { request, stats } = streamedRequest([bytes]);
    assert.deepEqual(await readRequestJson(request, 10), { ok: false, status: 400 });
    assert.equal(stats().locked, false);
  }
  assert.deepEqual(await readRequestJson(new Request('https://example.test/'), 10), { ok: false, status: 400 });
});

test('turns a failed upload stream into a controlled client error', async () => {
  const body = new ReadableStream({ start(controller) { controller.error(new Error('upload interrupted')); } });
  const request = new Request('https://example.test/', { method: 'POST', body, duplex: 'half' } as RequestInit);
  assert.deepEqual(await readRequestJson(request, 10), { ok: false, status: 400 });
  assert.equal(body.locked, false);
});
