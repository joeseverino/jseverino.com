import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createClient as cloudflareClient } from '../../bin/lib/cloudflare.ts';
import { createClient as githubClient } from '../../bin/lib/github.ts';
import type { Fetch } from '../../bin/lib/rest.ts';

const TOKEN = 'fixture-token-never-printed';
const ZONE_ID = '0123456789abcdef0123456789abcdef';

// A fetch that answers every request with one response and records what it was sent.
function recording(status: number, body: unknown) {
  const sent: RequestInit[] = [];
  const fetch: Fetch = async (_url, init) => {
    sent.push(init);
    return new Response(JSON.stringify(body), { status });
  };
  return { sent, fetch };
}

interface Provider {
  // One read, and one read of a resource that may be absent.
  calls(fetch: Fetch): { read(): Promise<unknown>; absent(): Promise<unknown> };
  // The read's error label, and what an absent resource reads as.
  label: string;
  missing: unknown;
  // A 403 body in the provider's documented error shape.
  denied: unknown;
}

const providers: Record<string, Provider> = {
  cloudflare: {
    calls: (fetch) => {
      const client = cloudflareClient({ token: TOKEN, fetch });
      client.ids.zone = ZONE_ID;
      return { read: () => client.get('/zones/:zone/settings'), absent: () => client.maybe('/zones/:zone/settings/x') };
    },
    label: '/zones/:zone/settings',
    missing: null,
    denied: { success: false, errors: [{ code: 9109, message: 'denied' }], messages: [], result: null },
  },
  github: {
    calls: (fetch) => {
      const client = githubClient({ token: TOKEN, fetch });
      return { read: () => client.get('/repos/example/site?per_page=1'), absent: () => client.isOn('/repos/example/site/x') };
    },
    label: '/repos/example/site',
    missing: false,
    denied: { message: 'denied', documentation_url: 'https://docs.github.com/rest', status: '403' },
  },
};

for (const [name, provider] of Object.entries(providers)) {
  describe(`the ${name} client`, () => {
    test('sends the token as a bearer header and bounds every request with a timeout', async () => {
      const { sent, fetch } = recording(200, { success: true, result: {} });
      await provider.calls(fetch).read();
      assert.equal(new Headers(sent[0]?.headers).get('authorization'), `Bearer ${TOKEN}`);
      assert.ok(sent[0]?.signal instanceof AbortSignal);
    });

    test('a failure names the call by its label, never the token or a resolved id', async () => {
      const { fetch } = recording(403, provider.denied);
      await assert.rejects(provider.calls(fetch).read(), (error: Error) => {
        assert.match(error.message, new RegExp(`^GET ${provider.label} → 403 \\(.*denied\\)$`));
        assert.ok(!error.message.includes(TOKEN));
        assert.ok(!error.message.includes(ZONE_ID));
        return true;
      });
    });

    test('a 404 reads as absent', async () => {
      const { fetch } = recording(404, {});
      assert.equal(await provider.calls(fetch).absent(), provider.missing);
    });
  });
}
