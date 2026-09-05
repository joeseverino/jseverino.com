// Brand identity the site builds from — a vendored mirror of
// the lockfile-pinned severino-brand contract. Regenerate with `npm run sync:tokens`;
// edit the values upstream, never here. Committed so the build stays self-sufficient.
//
// Plain .mjs so both the Astro site and the node asset generators can import it.
// Consumers:
//   - src/layouts/BaseLayout.astro  → theme color
//   - src/styles/brand.css          → CSS brand custom properties (via brandVarsCss)
//   - src/lib/web-styles.mjs        → the base.css + brand vars + font bundle for embedders
//   - bin/make-icons.mjs            → the brand mark (favicon, HD marks)
//   - bin/make-og-image / make-github-social → social-card palette
// The rendering logic lives in the branding-engine dependency; this file is the
// identity the site hands to it.
// tokens:start
export const BRAND_CONTRACT = {
  schema: 1,
  digest: 'sha256-2deb0e032c8114c28d4ea6c472a3dbe18024a096cbc50a352e425e0e76e58ab8',
};

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

export const CARD_COLORS = {
  panel: '#1E3A8A',
  panelDeep: '#14245C',
  onPanel: '#ffffff',
  accent: '#5B82D6',
  textSoft: '#DDE6FB',
  textMuted: '#A9C0E8',
};

export const PRIMARY_BY_THEME = {
  light: {
    primary: '#1E3A8A',
    deep: '#14245C',
  },
  dark: {
    primary: '#7C9CE0',
    deep: '#A8C0F0',
  },
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

// branding-engine's card renderer consumes semantic roles, while the source
// brand contract stores identity tokens. Keep that projection here so every
// generated card receives the same mapping.
export function brandCardColors() {
  return { ...CARD_COLORS };
}

// The brand custom properties every site surface AND every embedder needs
// ALONGSIDE the design system. They live in their own file, src/styles/brand.css
// (generated from here by `npm run sync:tokens`, imported by base.css):
// --color-primary is brand identity (swappable), the rest is the design system
// (stable). Owned here so the site stylesheet and the Obsidian plugin's preview
// don't each re-derive them — the re-derivation that once left --color-primary
// dead in the preview, killing base.css's tinted tables, links, and buttons.
//
// Navy is unreadable on a dark page, so dark mode uses the onDark pair. `deep`
// means "more emphasis", which is DARKER on a light page and LIGHTER on a dark
// one — hover states read the same either way.
//
// Do not put light-dark() inside these custom properties. Safari can preserve
// the light arm when a separately loaded stylesheet defines the variable before
// the page's color-scheme settles. Emit explicit selectors instead: this is the
// one theme contract consumed by brand.css and every generated embed bundle.
// sync-tokens passes the freshly pulled upstream pair so the generated file
// never lags the block above by one run.
export function brandVarsCss(themes = PRIMARY_BY_THEME) {
  const declarations = (primary, deep) =>
    `--color-primary:${primary};--color-primary-deep:${deep}`;
  const light = declarations(themes.light.primary, themes.light.deep);
  const dark = declarations(themes.dark.primary, themes.dark.deep);

  return [
    `:root{${light}}`,
    `@media(prefers-color-scheme:dark){:root:not([data-theme-mode="light"]){${dark}}}`,
    `:root[data-theme-mode="dark"]{${dark}}`,
    `:root[data-theme-mode="light"]{${light}}`,
  ].join('');
}
