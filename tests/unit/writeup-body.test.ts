import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripArticleChrome, stripRepeatedDescription } from '../../src/lib/writeup-body.ts';

test('a writeup body drops the H1, the lede blockquote, and the leading image its page renders from frontmatter', () => {
  assert.equal(stripArticleChrome('# Title\n\n> The lede.\n\n![Cover](./images/cover.png)\n\nBody.\n'), 'Body.\n');
});

test('a heading after the body opens is the body', () => {
  assert.equal(stripArticleChrome('Body first.\n\n# Later heading\n'), 'Body first.\n\n# Later heading\n');
});

test('a writeup body drops a paragraph that repeats its description and keeps the rest', () => {
  const markdown = '# Heading\n\n> A concise description.\n\nBody stays here.\n';
  assert.equal(stripRepeatedDescription(markdown, 'A concise description.'), '# Heading\n\nBody stays here.\n');
});
