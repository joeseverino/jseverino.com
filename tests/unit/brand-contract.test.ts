import assert from 'node:assert/strict';
import test from 'node:test';
import { brandCardColors, CARD_COLORS } from '../../src/lib/brand.ts';

test('each card render gets the card colors as its own copy, so no caller can change the shared projection', () => {
  const shared = structuredClone(CARD_COLORS);
  const colors = brandCardColors();
  assert.deepEqual(colors, shared);
  for (const role of Object.keys(colors) as (keyof typeof colors)[]) colors[role] = '#000000';
  assert.deepEqual(CARD_COLORS, shared);
});
