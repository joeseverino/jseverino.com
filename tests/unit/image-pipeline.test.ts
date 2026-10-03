import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPicture, enhanceImages, type Manifest } from '../../src/lib/images.ts';
import { renderPageHtml, renderWriteupHtml } from '../../src/lib/markdown.ts';
import { readJson } from '../../src/lib/json.ts';

const manifest = readJson<Manifest>(new URL('../../src/lib/image-manifest.json', import.meta.url));
const src = Object.keys(manifest)[0];
assert.ok(src, 'The synced image manifest must contain a fixture.');

test('page and writeup images use the same final width modifier', () => {
  const markdown = `![Diagram|120|320](${src})`;
  const page = enhanceImages(renderPageHtml(`::split\n${markdown}\n:::\nExplanation\n::`));
  const writeup = enhanceImages(renderWriteupHtml(markdown));
  for (const html of [page, writeup]) {
    assert.match(html, /<picture>/);
    assert.match(html, /alt="Diagram" width="320"/);
    assert.match(html, /sizes="\(min-width: 600px\) 320px, 100vw"/);
    assert.doesNotMatch(html, /Diagram\|/);
  }
});

test('image enhancement preserves escaped alt text and the lightbox opt-out', () => {
  const html = enhanceImages(renderWriteupHtml(`![A < B & "C" &copy;|320|nozoom](${src})`));
  assert.match(html, /<picture>/);
  assert.match(html, /alt="A &lt; B &amp; &quot;C&quot; ©"/);
  assert.match(html, /data-no-zoom/);
});

test('plain image fallback escapes every authored attribute exactly once', () => {
  const html = buildPicture({
    src: '/unknown.png?a=1&b=2',
    alt: 'A < B & "C" &copy;',
    class: 'diagram "wide"',
    sizes: '(min-width: 1px) 50% & 2px',
  });
  assert.equal(
    html,
    '<img src="/unknown.png?a=1&amp;b=2" alt="A &lt; B &amp; &quot;C&quot; &amp;copy;" class="diagram &quot;wide&quot;" loading="lazy" decoding="async">',
  );
});

test('picture enhancement decodes parser entities before one canonical escape pass', () => {
  const html = enhanceImages(renderWriteupHtml(`![A < B & "C" &copy;](${src})`));
  assert.match(html, /alt="A &lt; B &amp; &quot;C&quot; ©"/);
  assert.doesNotMatch(html, /&amp;(?:lt|amp|quot);/);
});
