// Brand identity the site builds from — a vendored mirror of
// severino-brand/brand/tokens.json (`brand`). Regenerate with `npm run sync:tokens`;
// edit the values upstream, never here. Committed so the build stays self-sufficient.
//
// Plain .mjs so both the Astro site and the node asset generators can import it.
// Consumers:
//   - src/layouts/BaseLayout.astro  → theme color
//   - src/pages/brand.css.ts        → CSS brand custom properties (via brandVarsCss)
//   - src/lib/web-styles.mjs        → the base.css + brand vars + font bundle for embedders
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
  onDark: {
    primary: '#7C9CE0',
    primaryDeep: '#A8C0F0',
  },
  glyph: 'JS',
};
// tokens:end

// The page background per theme, mirrored from the design system's --color-bg so
// the browser-chrome tint in BaseLayout tracks the page without restating a hex.
// surfaces:start
export const SURFACE = {
  light: '#ffffff',
  dark: '#131826',
};
// surfaces:end

// The brand custom properties every site surface AND every embedder needs
// ALONGSIDE base.css. They are deliberately NOT in base.css: --color-primary is
// brand identity (swappable), base.css is the design system (stable). Owned here
// so /brand.css (src/pages/brand.css.ts) and the Obsidian plugin's preview don't
// each re-derive them — the re-derivation that once left --color-primary dead in
// the preview, killing base.css's tinted tables, links, and buttons.
//
// Navy is unreadable on a dark page, so dark mode uses the onDark pair. `deep`
// means "more emphasis", which is DARKER on a light page and LIGHTER on a dark
// one — hover states read the same either way.
//
// Do not put light-dark() inside these custom properties. Safari can preserve
// the light arm when a separately loaded stylesheet defines the variable before
// the page's color-scheme settles. Emit explicit selectors instead: this is the
// one theme contract consumed by /brand.css and every generated embed bundle.
export function brandVarsCss() {
  const declarations = (primary, deep) =>
    `--color-primary:${primary};--color-primary-deep:${deep}`;
  const light = declarations(BRAND.navy, BRAND.navyDeep);
  const dark = declarations(BRAND.onDark.primary, BRAND.onDark.primaryDeep);

  return [
    `:root{${light}}`,
    `@media(prefers-color-scheme:dark){:root:not([data-theme-mode="light"]){${dark}}}`,
    `:root[data-theme-mode="dark"]{${dark}}`,
    `:root[data-theme-mode="light"]{${light}}`,
  ].join('');
}
