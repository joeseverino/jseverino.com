import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asyncCache } from '../../src/lib/async-cache.ts';

test('concurrent callers share one load and its successful result', async () => {
  let loads = 0;
  let finish!: (value: string) => void;
  const cached = asyncCache(() => {
    loads++;
    return new Promise<string>((resolve) => { finish = resolve; });
  });
  const first = cached();
  const second = cached();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(loads, 1);
  finish('ready');
  assert.deepEqual(await Promise.all([first, second, cached()]), ['ready', 'ready', 'ready']);
  assert.equal(loads, 1);
});

test('failed loads can be retried, including synchronous throws', async () => {
  let loads = 0;
  const cached = asyncCache(async () => {
    if (++loads === 1) throw new Error('temporary');
    return 'recovered';
  });
  await assert.rejects(cached(), /temporary/);
  assert.equal(await cached(), 'recovered');
  assert.equal(loads, 2);
  const throws = asyncCache<string>(() => { throw new Error('sync'); });
  await assert.rejects(throws(), /sync/);
});
