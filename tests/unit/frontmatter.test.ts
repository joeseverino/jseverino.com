import assert from 'node:assert/strict';
import { test } from 'node:test';

import { frontmatterBlock, parseFrontmatter, stringifyFrontmatter } from '../../src/lib/frontmatter.ts';

test('a fence on the first line opens frontmatter, and one line break after the close is dropped', () => {
  assert.deepEqual(parseFrontmatter('---\ntitle: A\n---\n\nBody\n'), { data: { title: 'A' }, content: '\nBody\n' });
  assert.deepEqual(parseFrontmatter('---\r\ntitle: A\r\n---\r\nBody'), { data: { title: 'A' }, content: 'Body' });
  assert.deepEqual(parseFrontmatter('﻿---\na: 1\n---\nx'), { data: { a: 1 }, content: 'x' });
});

test('text with no fence, an empty block, and an unclosed block each parse', () => {
  assert.deepEqual(parseFrontmatter('plain'), { data: {}, content: 'plain' });
  assert.deepEqual(parseFrontmatter('----\na: 1\n---\n'), { data: {}, content: '----\na: 1\n---\n' });
  assert.deepEqual(parseFrontmatter('---\n---\nbody'), { data: {}, content: 'body' });
  assert.deepEqual(parseFrontmatter('---\na: 1\n'), { data: { a: 1 }, content: '' });
});

test('frontmatterBlock counts a BOM in its offsets, and the first line starting `---` closes it', () => {
  assert.equal(frontmatterBlock('plain'), undefined);
  assert.equal(frontmatterBlock('----\na: 1\n---\n'), undefined);
  assert.deepEqual(frontmatterBlock('﻿---\na: 1\n---\nx'), { yaml: '\na: 1', yamlStart: 4, contentStart: 14, closed: true });
  assert.deepEqual(frontmatterBlock('---\na: 1\n----\nb: 2\n---\nx'), { yaml: '\na: 1', yamlStart: 3, contentStart: 12, closed: true });
  assert.deepEqual(frontmatterBlock('---\na: 1\n'), { yaml: '\na: 1\n', yamlStart: 3, contentStart: 9, closed: false });
});

test('stringifyFrontmatter round-trips a parse and writes no block for empty data', () => {
  const source = '---\ntitle: A\ntags:\n  - x\n---\nBody\n';
  const { data, content } = parseFrontmatter(source);
  assert.equal(stringifyFrontmatter(content, data), source);
  assert.equal(stringifyFrontmatter('Body', {}), 'Body\n');
});

test('YAML dates, merge keys, folded text and string scalars retain their types', () => {
  const source =
    '---\n# metadata\ndefaults: &defaults\n  published: true\n<<: *defaults\npublished_at: 2026-10-15\ntitle: "true"\ndescription: >-\n  First line\n  second line\n---\nBody\n';
  const { data, content } = parseFrontmatter(source);
  assert.equal(data.published, true);
  assert.deepEqual(data.published_at, new Date('2026-10-15T00:00:00Z'));
  assert.equal(data.title, 'true');
  assert.equal(data.description, 'First line second line');
  assert.deepEqual(parseFrontmatter(stringifyFrontmatter(content, data)), { data, content });
  assert.deepEqual(parseFrontmatter('---\n# only a comment\n---\nBody'), { data: {}, content: 'Body' });
});

test('a scalar or list block is refused as frontmatter', () => {
  for (const block of ['just text', '- a\n- b', '2026-10-15']) {
    assert.throws(() => parseFrontmatter(`---\n${block}\n---\nBody`), /frontmatter must be a mapping/);
  }
});
