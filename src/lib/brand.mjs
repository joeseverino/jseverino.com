// Brand identity the site builds from — a vendored mirror of
// severino-brand/brand/tokens.json (`brand`). Regenerate with `npm run sync:tokens`;
// edit the values upstream, never here. Committed so the build stays self-sufficient.
//
// Plain .mjs so both the Astro site and the node asset generators can import it.
// Consumers:
//   - src/layouts/BaseLayout.astro  → theme color
//   - src/pages/brand.css.ts        → CSS brand custom properties (navy → --color-primary, navyDeep → --color-primary-deep)
//   - bin/make-icons.mjs            → the brand mark (favicon, HD marks)
//   - bin/make-og-image / make-github-social → social-card palette
// The rendering logic lives in the branding-engine dependency; this file is the
// identity the site hands to it.
// tokens:start
export const BRAND = {
  navy: '#1E3A8A',
  navyDeep: '#14245C',
  onNavy: '#ffffff',
  card: {
    textMuted: '#A9C0E8',
    accent: '#5B82D6',
    textSoft: '#DDE6FB',
  },
  glyph: 'JS',
};
// tokens:end
