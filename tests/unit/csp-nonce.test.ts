// Unit tests for the build-time nonce placeholder (src/integrations/csp-nonce.ts):
// only the tag shapes Astro and the site's own components emit are stamped,
// so a script or style that reaches a page through content stays un-nonced.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installCloudflarePreview } from 'sitedrift';
import { stampNonces, unstampedTags } from '../../src/integrations/csp-nonce.ts';
import { CSP_NONCE_ATTRIBUTE, CSP_NONCE_PLACEHOLDER } from '../../functions/lib/csp-nonce.ts';
import { tempDir } from './helpers/fs.ts';

const page = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const astroScript = '<script type="module" src="/_astro/Header.astro_astro_type_script_index_0_lang.BGt9nm10.js"></script>';

describe('stampNonces', () => {
  test('stamps Astro bundled scripts anywhere and inlined styles in <head>', () => {
    const html = stampNonces(page('<style>p{}</style>', `<main></main>${astroScript}`));
    assert.match(html, /<style nonce="__CSP_NONCE__">p\{\}<\/style>/);
    assert.ok(html.includes(`<script ${CSP_NONCE_ATTRIBUTE} type="module" src="/_astro/`));
    assert.deepEqual(unstampedTags(html), []);
  });

  test('leaves source-stamped is:inline scripts as they are', () => {
    const inline = `<script ${CSP_NONCE_ATTRIBUTE}>theme()</script>`;
    assert.equal(stampNonces(page(inline, '')), page(inline, ''));
  });

  test('never stamps a style or inline script in the body', () => {
    const html = stampNonces(page('', '<div class="prose"><style>p{}</style><script>alert(1)</script></div>'));
    assert.deepEqual(unstampedTags(html), ['<style>', '<script>']);
  });

  test('never stamps a module script that is not one of the build bundles', () => {
    const foreign = [
      '<script type="module" src="https://evil.example/x.js"></script>',
      '<script type="module" src="/_astro/x.js" onload="alert(1)"></script>',
      '<script type="module">alert(1)</script>',
    ];
    const html = stampNonces(page('', foreign.join('')));
    assert.equal(unstampedTags(html).length, 3);
  });
});

describe('the sitedrift preview viewer', () => {
  test('every tag it writes carries the placeholder the middleware nonces', () => {
    const dir = tempDir('sitedrift-');
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>x</title></head><body>x</body></html>');
    const result = installCloudflarePreview({ dir, live: 'https://jseverino.com', nonce: CSP_NONCE_PLACEHOLDER, force: true });
    assert.equal(result.installed, true);
    const viewer = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.ok(viewer.includes('<script'), 'the page is the review viewer');
    assert.deepEqual(unstampedTags(viewer), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
