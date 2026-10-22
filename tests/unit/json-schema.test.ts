import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertMatches, validate, type JsonSchema } from '../../bin/lib/json-schema.ts';

const a: JsonSchema = { type: 'object', required: ['kind', 'a'], properties: { kind: { const: 'a' } } };
const b: JsonSchema = { type: 'object', required: ['kind', 'b'], properties: { kind: { const: 'b' } } };

test('oneOf accepts a value that matches exactly one alternative', () => {
  const schema: JsonSchema = { oneOf: [{ type: 'string' }, { type: 'null' }] };
  assert.deepEqual(validate(schema, 'x'), []);
  assert.deepEqual(validate(schema, null), []);
  assert.notDeepEqual(validate(schema, 3), []);
});

test('oneOf reports every alternative\'s problems when none match', () => {
  const problems = validate({ oneOf: [a, b] }, { kind: 'a' });
  assert.ok(problems.some((problem) => problem.includes('missing a')), problems.join('\n'));
  assert.ok(problems.some((problem) => problem.includes('missing b')), problems.join('\n'));
});

test('oneOf refuses a value that matches more than one alternative', () => {
  assert.notDeepEqual(validate({ oneOf: [{ type: 'object' }, { type: 'object', required: [] }] }, {}), []);
});

test('a problem names the path and the unexpected property', () => {
  const schema: JsonSchema = { type: 'object', properties: { rules: { type: 'array', items: { type: 'object', additionalProperties: false } } } };
  assert.deepEqual(validate(schema, { rules: [{}, { extra: 1 }] }), ['$.rules[1]: unexpected property extra']);
});

test('a keyword the validator does not know is an error, not ignored', () => {
  assert.throws(() => validate({ type: 'string', minLenght: 2 }, 'x'), /keyword.*minLenght/);
});

test('assertMatches throws with the label and every problem', () => {
  assert.throws(() => assertMatches({ type: 'object', required: ['a', 'b'] }, {}, 'repo.json'), /^Error: repo\.json does not match its schema:\n {2}\$: missing a\n {2}\$: missing b$/);
});
