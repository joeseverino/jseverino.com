import assert from 'node:assert/strict';
import { test } from 'node:test';
import { same, toolMain } from '../../bin/lib/drift.ts';

test('values compare equal whatever order an API returns their keys in', () => {
  assert.ok(same({ from_list: { name: 'list', key: 'uri' } }, { from_list: { key: 'uri', name: 'list' } }));
  assert.ok(same([{ a: 1, b: 2 }], [{ b: 2, a: 1 }]));
});

test('different values, and arrays in a different order, are not the same', () => {
  assert.ok(!same({ a: 1 }, { a: 2 }));
  assert.ok(!same({ a: 1 }, { a: 1, c: 0 }));
  assert.ok(!same({ a: 1 }, { a: 1, b: undefined }), 'a key set to undefined differs from a missing key');
  assert.ok(!same([1, 2], [2, 1]));
});

test('a bad invocation writes usage and exits 2, --help exits 0, and neither loads desired state', async () => {
  const main = toolMain({
    usage: 'usage: tool check|plan|apply',
    commandLine: 'tool',
    setup: () => assert.fail('setup ran for an invocation that does no work'),
  });
  for (const [argv, code] of [
    [['--help'], 0],
    [[], 2],
    [['deploy'], 2],
    [['check', 'extra'], 2],
    [['check', '--bogus'], 2],
  ] as const) {
    const lines: string[] = [];
    assert.equal(await main({ argv: [...argv], write: (line) => lines.push(line) }), code, argv.join(' '));
    assert.match(lines.join('\n'), /usage: tool/);
  }
});
