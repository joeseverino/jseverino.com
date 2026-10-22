import assert from 'node:assert/strict';
import test from 'node:test';

import { BRAND_CONTRACT, CARD_COLORS, brandCardColors } from '../../src/lib/brand.ts';

test('brand card roles derive from the canonical token projection', () => {
  assert.equal(BRAND_CONTRACT.schema, 1);
  assert.match(BRAND_CONTRACT.digest, /^sha256-[a-f0-9]{64}$/);
  assert.deepEqual(brandCardColors(), CARD_COLORS);
});

test('each card render gets its own copy of the colors, so no caller can change the shared projection', () => {
  assert.notEqual(brandCardColors(), CARD_COLORS);
});
