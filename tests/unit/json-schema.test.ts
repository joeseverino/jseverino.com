import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, type JsonSchema } from '../../bin/lib/json-schema.ts';

const a: JsonSchema = { type: 'object', required: ['kind', 'a'], properties: { kind: { const: 'a' } } };
const b: JsonSchema = { type: 'object', required: ['kind', 'b'], properties: { kind: { const: 'b' } } };

test('oneOf accepts a value that matches exactly one alternative', () => {
  const schema: JsonSchema = { oneOf: [{ type: 'string' }, { type: 'null' }] };
  assert.deepEqual(validate(schema, 'x'), []);
  assert.deepEqual(validate(schema, null), []);
  assert.equal(validate(schema, 3).length > 0, true);
});

test('oneOf reports every alternative\'s problems when none match', () => {
  assert.deepEqual(validate({ oneOf: [a, b] }, { kind: 'a' }), ['$: matches none of 2 alternatives (1: $: missing a; 2: $: missing b, $.kind: must be "b")']);
});

test('oneOf refuses a value that matches more than one alternative', () => {
  assert.deepEqual(validate({ oneOf: [{ type: 'object' }, { type: 'object', required: [] }] }, {}), ['$: matches 2 alternatives, expected exactly one']);
});
