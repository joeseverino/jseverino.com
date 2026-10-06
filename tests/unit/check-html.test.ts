import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { directiveLeaks, duplicateIds, headingSkips } from '../audits/check-html.ts';

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

describe('headingSkips', () => {
  test('a page that opens at h1 and steps down one level at a time is clean', () => {
    assert.deepEqual(headingSkips('<h1>Title</h1><h2>A</h2><h3>B</h3><h3>C</h3><h2>D</h2><h3>E</h3>'), []);
  });

  test('names a jump of more than one level, labelled with the heading text', () => {
    assert.deepEqual(headingSkips('<h1>Portfolio</h1><h3 class="card"><a href="/x/">Zero-Trust <span>Infra</span></a></h3>'), ['h1 -> h3 "Zero-Trust Infra"']);
  });

  test('a page that opens below h1 is a skip from the start; going back up is fine', () => {
    assert.deepEqual(headingSkips('<h2>First</h2><h3>Next</h3><h1>Top</h1>'), ['hstart -> h2 "First"']);
  });
});
