// Unit tests for the build-time nonce placeholder (src/integrations/csp-nonce.ts):
// only the tag shapes Astro and the site's own components emit are stamped,
// so a script or style that reaches a page through content stays un-nonced.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { stampNonces, stampSitedriftViewer, unstampedTags } from '../../src/integrations/csp-nonce.ts';
import { renderHostedViewer } from './helpers/sitedrift-internals.ts';
import { CSP_NONCE_ATTRIBUTE } from '../../functions/lib/csp-nonce.ts';

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

describe('stampSitedriftViewer', () => {
  test('stamps both scripts of the hosted review viewer', () => {
    const html = stampSitedriftViewer(renderHostedViewer({ live: 'https://jseverino.com', brand: 'x', initialPath: '/' }));
    assert.equal(html.split('<script').length - 1, 2);
    assert.deepEqual(unstampedTags(html), []);
  });
});
