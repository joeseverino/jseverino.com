import assert from 'node:assert/strict';
import test from 'node:test';

import { BRAND_CONTRACT, CARD_COLORS, brandCardColors } from '../../src/lib/brand.mjs';
import { SITE } from '../../src/lib/site-config.mjs';

test('brand card roles derive from the canonical token projection', () => {
  assert.equal(BRAND_CONTRACT.schema, 1);
  assert.match(BRAND_CONTRACT.digest, /^sha256-[a-f0-9]{64}$/);
  assert.deepEqual(brandCardColors(), CARD_COLORS);
  assert.notEqual(brandCardColors(), CARD_COLORS);
});

test('public focus copy derives from one ordered identity list', () => {
  assert.deepEqual(SITE.focus, ['Cybersecurity', 'Networking', 'AI']);
  assert.equal(SITE.focus.join(' • '), 'Cybersecurity • Networking • AI');
});
