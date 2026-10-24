import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { buildCsp, PLACEHOLDERS } from '../../bin/build-csp.ts';
import { CSP_INLINE_MARKER, hashSource } from '../../src/lib/csp.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const scratch = scratchDirs('build-csp-');
after(scratch.cleanup);

const page = (extra = '') => `<html><head><script nonce="${CSP_INLINE_MARKER}">theme()</script><style>body{}</style></head><body>${extra}</body></html>`;
const headers = `/*\n  Content-Security-Policy: __CSP__\n  Reporting-Endpoints: __REPORTING_ENDPOINTS__\n\n/contact/*\n  ! Content-Security-Policy\n  Content-Security-Policy: __CSP_CONTACT__\n  Content-Security-Policy-Report-Only: __TT_REPORT_ONLY__\n`;

function dist(pages: Record<string, string>): string {
  const dir = path.join(scratch.make(), 'client');
  write(path.join(dir, '_headers'), headers);
  for (const [name, html] of Object.entries(pages)) write(path.join(dir, name), html);
  return dir;
}

// Beside the served tree, where the build keeps it.
const template = (dir: string) => path.join(dir, '..', '_headers.template');
const run = (dir: string) => buildCsp(dir, template(dir));
// What the sitedrift wrap does to a page: a new document with its own marked inline tags.
const viewer = `<html><head><style nonce="${CSP_INLINE_MARKER}">.viewer{}</style></head><body><script type="application/json">{}</script></body></html>`;

describe('buildCsp', () => {
  test('hashes the shared inline tags once, leaves the pages as built, and fills every placeholder', async () => {
    const dir = dist({ 'index.html': page(), 'about/index.html': page(), '404.html': page() });
    const result = await run(dir);
    assert.equal(result.pages, 3);
    assert.deepEqual(result.scriptHashes, [await hashSource('theme()')]);
    assert.deepEqual(result.styleHashes, [await hashSource('body{}')]);

    const built = fs.readFileSync(path.join(dir, '_headers'), 'utf8');
    for (const placeholder of PLACEHOLDERS) assert.ok(!built.includes(placeholder), placeholder);
    assert.ok(built.includes(`'${await hashSource('theme()')}'`));
    assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), page());
  });

  test('the contact policy differs only in Trusted Types, which it reports instead', async () => {
    const dir = dist({ 'index.html': page() });
    await run(dir);
    const lines = fs
      .readFileSync(path.join(dir, '_headers'), 'utf8')
      .split('\n')
      .map((line) => line.trim());
    const enforced = lines.filter((line) => line.startsWith('Content-Security-Policy: '));
    assert.equal(enforced.length, 2);
    assert.match(enforced[0] ?? '', /require-trusted-types-for 'script'/);
    assert.doesNotMatch(enforced[1] ?? '', /require-trusted-types-for/);
    assert.ok(lines.some((line) => line.startsWith("Content-Security-Policy-Report-Only: require-trusted-types-for 'script'")));
  });

  test('fails on an inline script the site did not mark, naming the page', async () => {
    const dir = dist({ 'index.html': page(), 'portfolio/x/index.html': page('<script>steal()</script>') });
    await assert.rejects(run(dir), /portfolio[\\/]x[\\/]index\.html: inline script the site did not mark/);
  });

  test('fails when the _headers placeholders are missing', async () => {
    const dir = dist({ 'index.html': page() });
    write(path.join(dir, '_headers'), '/*\n  X-Test: 1\n');
    await assert.rejects(run(dir), /no __CSP__ placeholder/);
  });

  test('fails when pages grow more inline scripts than the policy expects', async () => {
    const pages = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`p${i}.html`, `<head><script nonce="${CSP_INLINE_MARKER}">v${i}()</script><style>a{}</style></head>`]),
    );
    await assert.rejects(run(dist(pages)), /5 inline script/);
  });

  test('a second run on a wrapped build fills _headers as a first run on that wrapped build would', async () => {
    const pages = { 'index.html': page(), 'about/index.html': page(), '404.html': page() };
    const wrapped = { 'index.html': viewer, 'about/index.html': viewer };

    const fresh = dist({ ...pages, ...wrapped });
    await run(fresh);

    const built = dist(pages);
    await run(built);
    for (const [name, html] of Object.entries(wrapped)) write(path.join(built, name), html);
    await run(built);

    const read = (dir: string, name: string) => fs.readFileSync(path.join(dir, name), 'utf8');
    assert.equal(read(built, '_headers'), read(fresh, '_headers'));
    for (const name of ['index.html', '404.html']) assert.equal(read(built, name), read(fresh, name));
    assert.ok(read(built, '_headers').includes(`'${await hashSource('.viewer{}')}'`));
  });

  test('a second run scans every page again, so an unmarked script added after the build still fails', async () => {
    const dir = dist({ 'index.html': page(), '404.html': page() });
    await run(dir);
    write(path.join(dir, '404.html'), page('<script>steal()</script>'));
    await assert.rejects(run(dir), /404\.html: inline script the site did not mark/);
  });
});
