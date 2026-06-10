import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { anyWriteup } from './helpers/writeups.ts';

// Accessibility sweep with axe-core over the key page archetypes: home,
// listing, writeup, form, and resume. The static check-html audit covers the
// cheap structural rules (unique ids, alt presence) on every page; this runs
// the full WCAG A/AA ruleset in a real browser, where label association,
// landmark structure, and computed color contrast actually resolve.
// Engine-independent, so *.single.

const pages = ['/', '/portfolio/', anyWriteup(), '/contact/', '/resume/'];

// Abort the Turnstile challenge script the same way contact.spec.ts does: its
// widget keeps network activity alive on CI (which is also why this spec must
// not wait for networkidle), and axe scans the site's own markup, not
// Cloudflare's iframe.
test.beforeEach(async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/**', (route) => route.abort());
});

for (const path of pages) {
  test(`axe finds no WCAG A/AA violations on ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = results.violations.map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes.length} node(s), e.g. ${violation.nodes[0]?.target}`,
    );
    expect(violations).toEqual([]);
  });
}
