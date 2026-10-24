import assert from 'node:assert/strict';
import { test } from 'node:test';
import { elementsNamed, linkHref, metaContent, parseHtml, textContent, title } from '../../src/lib/html.ts';

const page = parseHtml(`<!doctype html><html><head>
<title> R&amp;D &#39;Notes&#x27; &mdash; Example </title>
<meta name="description" content="Say &quot;hi&quot; &amp; leave">
<meta content="Card" property="og:title">
<link rel="alternate canonical" href="https://example.com/a?b=1&amp;c=2">
</head><body><svg><title>Icon</title></svg></body></html>`);

test('readers return decoded values from a built page', () => {
  assert.equal(title(page), "R&D 'Notes' — Example");
  assert.equal(metaContent(page, 'description'), 'Say "hi" & leave');
  assert.equal(metaContent(page, 'og:title'), 'Card');
  assert.equal(linkHref(page, 'canonical'), 'https://example.com/a?b=1&c=2');
});

test('readers report an absent element as undefined', () => {
  assert.equal(metaContent(page, 'robots'), undefined);
  assert.equal(linkHref(page, 'icon'), undefined);
  assert.equal(title(parseHtml('<p>no head</p>')), undefined);
});

test('elementsNamed walks the whole tree in document order; textContent reads a script raw', () => {
  const doc = parseHtml('<head><script type="application/ld+json">{"a":"&amp;"}</script></head><body><div><script>let b = 1 < 2;</script></div></body>');
  assert.deepEqual(elementsNamed(doc, 'script').map(textContent), ['{"a":"&amp;"}', 'let b = 1 < 2;']);
  assert.deepEqual(elementsNamed(doc, 'style'), []);
});
