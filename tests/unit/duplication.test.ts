import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findClones, tokenize } from '../audits/check-duplication.ts';

const block = Array.from({ length: 8 }, (_, i) => `  total += values[${i}] * weights[${i}];`).join('\n');
const source = (name: string) => `export function ${name}(values: number[], weights: number[]) {\n  let total = 0;\n${block}\n  return total;\n}\n`;

test('a block repeated across files is a clone, reported once with its lines', () => {
  const clones = findClones(new Map([['bin/a.ts', tokenize(source('a'))], ['src/b.ts', tokenize(source('b'))]]));
  assert.equal(clones.length, 1);
  assert.deepEqual([clones[0]?.a.file, clones[0]?.b.file], ['bin/a.ts', 'src/b.ts']);
  assert.ok((clones[0]?.tokens ?? 0) >= 30);
});

test('distinct code, and shared import lines, are not clones', () => {
  const imports = Array.from({ length: 12 }, (_, i) => `import { name${i} } from './module-${i}.ts';`).join('\n');
  const clones = findClones(new Map([
    ['bin/a.ts', tokenize(`${imports}\nexport const a = 1;\n`)],
    ['bin/b.ts', tokenize(`${imports}\nexport const b = 2;\n`)],
  ]));
  assert.deepEqual(clones, []);
});
