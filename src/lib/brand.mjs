// Canonical brand tokens — the single source of truth for brand identity.
// Plain .mjs so both the Astro site and the node asset generators can import it.
//
// Consumers:
//   - src/layouts/BaseLayout.astro  → <meta name="theme-color">
//   - bin/lib/mark.mjs              → the brand mark (favicon, OG, social)
//   - src/styles/base.css           → --color-primary mirrors BRAND.navy (kept in sync by hand)
export const BRAND = {
  navy: '#1E3A8A',
  onNavy: '#ffffff',
  glyph: 'JS', // Joe Severino
};
