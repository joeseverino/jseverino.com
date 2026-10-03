import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFrontmatter, stringifyFrontmatter } from '../../src/lib/frontmatter.ts';

test('parse: fence on the first line, one line break dropped after the close', () => {
  assert.deepEqual(parseFrontmatter('---\ntitle: A\n---\n\nBody\n'), { data: { title: 'A' }, content: '\nBody\n' });
  assert.deepEqual(parseFrontmatter('---\r\ntitle: A\r\n---\r\nBody'), { data: { title: 'A' }, content: 'Body' });
  assert.deepEqual(parseFrontmatter('﻿---\na: 1\n---\nx'), { data: { a: 1 }, content: 'x' });
});

test('parse: no fence, an empty block, and an unclosed block', () => {
  assert.deepEqual(parseFrontmatter('plain'), { data: {}, content: 'plain' });
  assert.deepEqual(parseFrontmatter('----\na: 1\n---\n'), { data: {}, content: '----\na: 1\n---\n' });
  assert.deepEqual(parseFrontmatter('---\n---\nbody'), { data: {}, content: 'body' });
  assert.deepEqual(parseFrontmatter('---\na: 1\n'), { data: { a: 1 }, content: '' });
});

test('stringify: round-trips and omits an empty block', () => {
  const source = '---\ntitle: A\ntags:\n  - x\n---\nBody\n';
  const { data, content } = parseFrontmatter(source);
  assert.equal(stringifyFrontmatter(content, data), source);
  assert.equal(stringifyFrontmatter('Body', {}), 'Body\n');
});
