import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accessHeaders, isAccessChallenge, isPreviewDeployment } from '../../bin/lib/access.ts';
import { wranglerConfig } from '../../bin/lib/wrangler-config.ts';
import { PREVIEW_HOST_SUFFIX, SITE } from '../../src/lib/site-config.ts';

const env = { CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 'secret' };

test("access headers go only to the Worker's preview URLs, and only with both values", () => {
  assert.deepEqual(accessHeaders(`https://0b43cfea${PREVIEW_HOST_SUFFIX}/`, env), {
    'CF-Access-Client-Id': 'id',
    'CF-Access-Client-Secret': 'secret',
  });
  assert.deepEqual(accessHeaders('https://jseverino.com/', env), {});
  assert.deepEqual(accessHeaders(`https://0b43cfea${PREVIEW_HOST_SUFFIX}/`, { CF_ACCESS_CLIENT_ID: 'id' }), {});
});

test('the token goes to one-label preview hosts of this Worker only', () => {
  const sent = (url: string) => Object.keys(accessHeaders(url, env)).length > 0;
  assert.equal(sent(`https://feature-x${PREVIEW_HOST_SUFFIX}/a`), true);
  assert.equal(sent(`https://${PREVIEW_HOST_SUFFIX.slice(1)}/`), false);
  assert.equal(sent('https://feature-x-other.severino.workers.dev/'), false);
  assert.equal(sent('https://evil.workers.dev/'), false);
  assert.equal(sent(`https://a.b${PREVIEW_HOST_SUFFIX}/`), false);
  assert.equal(sent(`https://x${PREVIEW_HOST_SUFFIX}.evil.example/`), false);
  assert.equal(sent(`http://0b43cfea${PREVIEW_HOST_SUFFIX}/`), false);
  assert.equal(isPreviewDeployment('https://x-site.example.workers.dev/', '-site.example.workers.dev'), true);
});

test('the preview host names the Worker wrangler.jsonc deploys', () => {
  assert.equal(wranglerConfig().name, SITE.worker);
  assert.ok(PREVIEW_HOST_SUFFIX.startsWith(`-${SITE.worker}.`));
});

test('a redirect to the Access login is a challenge; other redirects are not', () => {
  const challenge = new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/x' } });
  const plain = new Response(null, { status: 301, headers: { location: 'https://jseverino.com/' } });
  assert.equal(isAccessChallenge(challenge), true);
  assert.equal(isAccessChallenge(plain), false);
  assert.equal(isAccessChallenge(new Response('ok', { status: 200 })), false);
});
