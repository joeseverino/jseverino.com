import assert from 'node:assert/strict';
import test from 'node:test';
import { webContract } from 'severino-brand';
import { BRAND_CONTRACT, brandCardColors, CARD_COLORS } from '../../src/lib/brand.ts';

test('the vendored mirror names the severino-brand contract the lockfile pins', () => {
  assert.deepEqual(BRAND_CONTRACT, { schema: webContract.schema, digest: webContract.digest });
});

test('each card render gets the card colors as its own copy, so no caller can change the shared projection', () => {
  const shared = structuredClone(CARD_COLORS);
  const colors = brandCardColors();
  assert.deepEqual(colors, shared);
  for (const role of Object.keys(colors) as (keyof typeof colors)[]) colors[role] = '#000000';
  assert.deepEqual(CARD_COLORS, shared);
});
