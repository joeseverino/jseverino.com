import assert from 'node:assert/strict';
import test from 'node:test';

import { BRAND, brandCardColors } from '../../src/lib/brand.mjs';
import { SITE } from '../../src/lib/site-config.mjs';

test('brand card roles derive from the canonical token projection', () => {
  assert.deepEqual(brandCardColors(), {
    panel: BRAND.navy,
    panelDeep: BRAND.navyDeep,
    onPanel: BRAND.onNavy,
    accent: BRAND.card.accent,
    textSoft: BRAND.card.textSoft,
    textMuted: BRAND.card.textMuted,
  });
});

test('public focus copy derives from one ordered identity list', () => {
  assert.deepEqual(SITE.focus, ['Cybersecurity', 'Networking', 'AI']);
  assert.equal(SITE.focus.join(' • '), 'Cybersecurity • Networking • AI');
});
