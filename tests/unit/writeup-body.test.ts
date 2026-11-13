import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripArticleChrome } from '../../src/lib/writeup-body.ts';

test('a writeup body drops the H1, the lede blockquote, and the leading image its page renders from frontmatter', () => {
  assert.equal(stripArticleChrome('# Title\n\n> The lede.\n\n![Cover](./images/cover.png)\n\nBody.\n'), 'Body.\n');
});

test('a heading after the body opens is the body', () => {
  assert.equal(stripArticleChrome('Body first.\n\n# Later heading\n'), 'Body first.\n\n# Later heading\n');
});
