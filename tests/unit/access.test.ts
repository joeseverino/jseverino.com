import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accessHeaders, isAccessChallenge, isPagesDeployment } from '../../bin/lib/access.ts';
import path from 'node:path';
import { readJson } from '../../src/lib/json.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { PAGES_HOST, SITE } from '../../src/lib/site-config.ts';

const env = { CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 'secret' };

test('access headers go only to pages.dev deployments, and only with both values', () => {
  assert.deepEqual(accessHeaders('https://0b43cfea.jseverino.pages.dev/', env), {
    'CF-Access-Client-Id': 'id',
    'CF-Access-Client-Secret': 'secret',
  });
  assert.deepEqual(accessHeaders('https://jseverino.com/', env), {});
  assert.deepEqual(accessHeaders('https://0b43cfea.jseverino.pages.dev/', { CF_ACCESS_CLIENT_ID: 'id' }), {});
});

test('the token goes to the project host and one-label subdomains only', () => {
  const sent = (url: string) => Object.keys(accessHeaders(url, env)).length > 0;
  assert.equal(sent(`https://${PAGES_HOST}/`), true);
  assert.equal(sent(`https://feature-x.${PAGES_HOST}/a`), true);
  assert.equal(sent('https://0b43cfea.other-project.pages.dev/'), false);
  assert.equal(sent('https://evil.pages.dev/'), false);
  assert.equal(sent(`https://a.b.${PAGES_HOST}/`), false);
  assert.equal(sent(`https://${PAGES_HOST}.evil.example/`), false);
  assert.equal(sent(`https://evil${PAGES_HOST}/`), false);
  assert.equal(sent(`http://0b43cfea.${PAGES_HOST}/`), false);
  assert.equal(isPagesDeployment('https://x.example.pages.dev/', 'example.pages.dev'), true);
});

test('the pages project in site config matches cloudflare/zone.json', () => {
  const zone = readJson<{ pages: { project: string } }>(path.join(siteRoot, 'cloudflare/zone.json'));
  assert.equal(zone.pages.project, SITE.pagesProject);
});

test('a redirect to the Access login is a challenge; other redirects are not', () => {
  const challenge = new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/x' } });
  const plain = new Response(null, { status: 301, headers: { location: 'https://jseverino.com/' } });
  assert.equal(isAccessChallenge(challenge), true);
  assert.equal(isAccessChallenge(plain), false);
  assert.equal(isAccessChallenge(new Response('ok', { status: 200 })), false);
});
