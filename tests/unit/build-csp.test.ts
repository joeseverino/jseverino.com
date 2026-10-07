import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLACEHOLDERS, buildCsp } from '../../bin/build-csp.ts';
import { CSP_INLINE_MARKER, hashSource } from '../../functions/lib/csp.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const scratch = scratchDirs('build-csp-');
after(scratch.cleanup);

const page = (extra = '') =>
  `<html><head><script nonce="${CSP_INLINE_MARKER}">theme()</script><style>body{}</style></head><body>${extra}</body></html>`;
const headers = `/*\n  Content-Security-Policy: __CSP__\n  Reporting-Endpoints: __REPORTING_ENDPOINTS__\n\n/contact/*\n  ! Content-Security-Policy\n  Content-Security-Policy: __CSP_CONTACT__\n  Content-Security-Policy-Report-Only: __TT_REPORT_ONLY__\n`;

function dist(pages: Record<string, string>): string {
  const dir = scratch.make();
  write(path.join(dir, '_headers'), headers);
  for (const [name, html] of Object.entries(pages)) write(path.join(dir, name), html);
  return dir;
}

describe('buildCsp', () => {
  test('hashes the shared inline tags once, strips the marker, and fills every placeholder', async () => {
    const dir = dist({ 'index.html': page(), 'about/index.html': page(), '404.html': page() });
    const result = await buildCsp(dir);
    assert.equal(result.pages, 3);
    assert.deepEqual(result.scriptHashes, [await hashSource('theme()')]);
    assert.deepEqual(result.styleHashes, [await hashSource('body{}')]);

    const built = fs.readFileSync(path.join(dir, '_headers'), 'utf8');
    for (const placeholder of PLACEHOLDERS) assert.ok(!built.includes(placeholder), placeholder);
    assert.ok(built.includes(`'${await hashSource('theme()')}'`));
    assert.ok(!fs.readFileSync(path.join(dir, 'index.html'), 'utf8').includes(CSP_INLINE_MARKER));
  });

  test('the contact policy differs only in Trusted Types, which it reports instead', async () => {
    const dir = dist({ 'index.html': page() });
    await buildCsp(dir);
    const lines = fs.readFileSync(path.join(dir, '_headers'), 'utf8').split('\n').map((line) => line.trim());
    const enforced = lines.filter((line) => line.startsWith('Content-Security-Policy: '));
    assert.equal(enforced.length, 2);
    assert.match(enforced[0] ?? '', /require-trusted-types-for 'script'/);
    assert.doesNotMatch(enforced[1] ?? '', /require-trusted-types-for/);
    assert.ok(lines.some((line) => line.startsWith("Content-Security-Policy-Report-Only: require-trusted-types-for 'script'")));
  });

  test('fails on an inline script the site did not mark, naming the page', async () => {
    const dir = dist({ 'index.html': page(), 'portfolio/x/index.html': page('<script>steal()</script>') });
    await assert.rejects(buildCsp(dir), /portfolio[\\/]x[\\/]index\.html: inline script the site did not mark/);
  });

  test('fails when the _headers placeholders are missing', async () => {
    const dir = dist({ 'index.html': page() });
    write(path.join(dir, '_headers'), '/*\n  X-Test: 1\n');
    await assert.rejects(buildCsp(dir), /no __CSP__ placeholder/);
  });

  test('fails when pages grow more inline scripts than the policy expects', async () => {
    const pages = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`p${i}.html`, `<head><script nonce="${CSP_INLINE_MARKER}">v${i}()</script><style>a{}</style></head>`]));
    await assert.rejects(buildCsp(dist(pages)), /5 inline script/);
  });
});
