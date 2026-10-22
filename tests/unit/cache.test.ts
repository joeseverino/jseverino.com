import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { cacheDir } from '../../bin/lib/cache.ts';

test('the cache root comes from SITE_CACHE_DIR, the one root every checkout shares', () => {
  assert.equal(cacheDir({ SITE_CACHE_DIR: '/var/cache/site' }), path.resolve('/var/cache/site'));
});

test('an unset cache root names mise as the fix rather than falling back to the checkout', () => {
  assert.throws(() => cacheDir({}), /SITE_CACHE_DIR is unset.*mise/);
});
