type JsonBody = { ok: true; value: unknown } | { ok: false; status: 400 | 413 };

export function requestMediaType(request: Request): string {
  return (request.headers.get('Content-Type') ?? '').split(';', 1)[0].trim().toLowerCase();
}

/** Bound bytes while reading, even when Content-Length is absent or inaccurate. */
export async function readRequestJson(request: Request, maxBytes: number): Promise<JsonBody> {
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    void request.body?.cancel().catch(() => {});
    return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: false, status: 400 };

  const reader = request.body.getReader();
  const buffer = new Uint8Array(maxBytes);
  let length = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      if (length + value.byteLength > maxBytes) return { ok: false, status: 413 };
      buffer.set(value, length);
      length += value.byteLength;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    // Do not wait for the sender to finish a body that has already been rejected.
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
