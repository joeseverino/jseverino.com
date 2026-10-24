import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { mapLimit } from '../../bin/lib/map-limit.ts';

test('mapLimit never runs more than the limit at once, and keeps the input order', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n: number) => {
    running += 1;
    peak = Math.max(peak, running);
    await sleep(n % 2 ? 10 : 2);
    running -= 1;
    return n * 2;
  });
  assert.equal(peak, 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12]);
});

test('mapLimit over no items resolves empty', async () => {
  assert.deepEqual(await mapLimit([], 4, async () => 1), []);
});
