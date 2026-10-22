import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJsonText, jsonFingerprint } from '../../src/lib/canonical-json.ts';

test('equal JSON is equal whatever its key order and whitespace', () => {
  assert.equal(canonicalJsonText('{"b": [1, {"d": 2, "c": 3}], "a": null}'), canonicalJsonText('{"a":null,"b":[1,{"c":3,"d":2}]}'));
  assert.notEqual(canonicalJsonText('[1, 2]'), canonicalJsonText('[2, 1]'), 'array order is data');
  assert.equal(jsonFingerprint({ b: 1, a: 2 }), jsonFingerprint({ a: 2, b: 1 }));
});

test('text that is not JSON has no canonical form', () => {
  assert.equal(canonicalJsonText('openapi: 3.0.3'), null);
});
