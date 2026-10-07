import { test } from 'node:test';
import assert from 'node:assert/strict';
import { same } from '../../bin/lib/drift.ts';

test('values compare equal whatever order an API returns their keys in', () => {
  assert.ok(same({ from_list: { name: 'list', key: 'uri' } }, { from_list: { key: 'uri', name: 'list' } }));
  assert.ok(same([{ a: 1, b: 2 }], [{ b: 2, a: 1 }]));
});

test('different values, and arrays in a different order, are not the same', () => {
  assert.ok(!same({ a: 1 }, { a: 2 }));
  assert.ok(!same({ a: 1 }, { a: 1, b: undefined, c: 0 }));
  assert.ok(!same([1, 2], [2, 1]));
});
