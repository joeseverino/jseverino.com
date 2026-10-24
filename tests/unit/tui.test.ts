// The terminal layer's measuring, clipping and windowing, and the key table every binding names.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { styleText } from 'node:util';
import { BINDINGS } from '../../bin/site/manage-input.ts';
import { fitFrame, KEYS, keyOf, keySequence, truncate } from '../../bin/site/tui.ts';

test('a pictograph in text presentation is one cell and an emoji is two', () => {
  for (const text of ['a™b', 'a©b', 'a®b', 'a↔b']) assert.equal(truncate(text, 3), text);
  assert.equal(truncate('a😀b', 3), 'a…');
  assert.equal(truncate('a❤️b', 3), 'a…');
});

test('a clip resets only when it cuts a styled span before its close', () => {
  const green = (text: string) => styleText('green', text, { validateStream: false });
  assert.ok(truncate(green('abcdef'), 4).endsWith('\x1b[0m…'));
  assert.equal(truncate(`${green('ab')}cdef`, 4), `${green('ab')}c…`);
});

test('a frame taller than the terminal keeps its header and footer and shows its focus line', () => {
  const body = Array.from({ length: 40 }, (_, i) => `row ${i}`);
  // A glyph outside the focus line must not move the window.
  body[2] = '▸ not the focus';
  const lines = fitFrame({ head: ['head'], body, foot: ['foot 1', 'foot 2'], focus: 30 }, 80, 10);
  assert.equal(lines.length, 10);
  assert.equal(lines[0], 'head');
  assert.deepEqual(lines.slice(-2), ['foot 1', 'foot 2']);
  assert.ok(lines.includes('row 30'));
  assert.ok(!lines.includes('▸ not the focus'));
});

test('every key a binding names is in the key table or is the one character it types', () => {
  for (const [mode, bindings] of Object.entries(BINDINGS)) {
    const seen = new Set<string>();
    for (const key of bindings.flatMap((binding) => binding.keys)) {
      assert.ok(Object.hasOwn(KEYS, key) || [...key].length === 1, `${mode}: unknown key ${key}`);
      assert.ok(!seen.has(key), `${mode}: ${key} is bound twice`);
      seen.add(key);
    }
  }
});

test('a replay name sends the sequence the handlers read back as that name', () => {
  for (const name of Object.keys(KEYS)) assert.equal(keyOf(keySequence(name) ?? ''), name);
});
