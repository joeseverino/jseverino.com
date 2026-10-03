import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directiveLeaks, duplicateIds } from '../audits/check-html.ts';

test('a directive left in page text is a leak', () => {
  assert.deepEqual(directiveLeaks('<p>::termnial</p>\n<p>text</p>'), ['termnial']);
  assert.deepEqual(directiveLeaks('<div>intro\n::hero ::\n</div>'), ['hero']);
  assert.deepEqual(directiveLeaks('<li>a</li><li>::figure</li>'), ['figure']);
});

test('code, markup, and words containing :: are not directives', () => {
  const html = [
    '<style>a::before { content: ""; }</style>',
    '<script>const s = "::terminal";</script>',
    '<pre><code>::terminal\n$ ls\n::</code></pre>',
    '<p>Use <code>::figure</code> for images; std::vector and ::1 are fine.</p>',
    '<!-- ::hero -->',
    '<a title="::buttons" href="/">link</a>',
  ].join('\n');
  assert.deepEqual(directiveLeaks(html), []);
});

test('duplicate ids are counted per value', () => {
  const { ids, repeated } = duplicateIds('<h2 id="a"></h2><p id="b"></p><h3 id="a"></h3>');
  assert.equal(ids, 3);
  assert.deepEqual(repeated, [['a', 2]]);
});
