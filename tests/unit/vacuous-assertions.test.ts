import assert from 'node:assert/strict';
import { test } from 'node:test';
import { biomeFindings } from './helpers/biome.ts';

// The rule biome.jsonc applies to tests/, run over one spec.
const flagged = (source: string[]): string[] => biomeFindings(['vacuous-assertions'], 'fixture.test.ts', source.join('\n')).map(({ line }) => line);

test('an inequality against an empty list or a fresh object, array or instance is refused', () => {
  const source = [
    'assert.notDeepEqual(problems(), []);',
    'assert.notDeepStrictEqual(problems(), []);',
    'assert.notEqual(colors(), { panel: 1 });',
    'assert.notEqual([1], value);',
    'assert.notStrictEqual(value, new Map());',
    '',
  ];
  assert.deepEqual(flagged(source), source.slice(0, 5));
});

test('an inequality between two results, or against a primitive, passes', () => {
  assert.deepEqual(flagged(['assert.notEqual(result.code, 0);', 'assert.notDeepEqual(before, after);', 'assert.notEqual(hash(a), hash(b));', '']), []);
});
