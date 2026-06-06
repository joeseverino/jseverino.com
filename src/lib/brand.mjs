// Canonical brand tokens — the single source of truth for brand identity.
// Plain .mjs so both the Astro site and the node asset generators can import it.
//
// Consumers:
//   - src/layouts/BaseLayout.astro  → theme color
//   - src/pages/brand.css.ts        → CSS brand custom properties
//   - bin/lib/mark.mjs              → the brand mark (favicon, OG, social)
//   - bin/lib/card.mjs              → social-card palette
export const BRAND = {
  navy: '#1E3A8A',
  navyDeep: '#14245C', // hover/active + card gradient end
  onNavy: '#ffffff',
  card: {
    textMuted: '#A9C0E8',
    accent: '#5B82D6',
    textSoft: '#DDE6FB',
  },
  glyph: 'JS', // Joe Severino
};
