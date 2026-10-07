// Vendored mirror of the lockfile-pinned severino-brand contract. Regenerate with
// `npm run sync:tokens`; edit upstream. Dependency-free so node generators can import it.
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

// Page background per theme, mirrored from --color-bg for the browser-chrome tint.
// surfaces:start
export const SURFACE = {
  light: '#ffffff',
  dark: '#131826',
};
// surfaces:end

// Projects identity tokens onto the semantic roles branding-engine's card renderer reads.
export function brandCardColors(): typeof CARD_COLORS {
  return { ...CARD_COLORS };
}

// Brand custom properties for the site and every embedder, generated into
// src/styles/brand.css by `npm run sync:tokens`. Dark mode uses the onDark pair;
// `deep` is darker on light and lighter on dark. No light-dark() in the properties:
// Safari can keep the light arm in a separately loaded stylesheet, so emit selectors.
export function brandVarsCss(themes: typeof PRIMARY_BY_THEME = PRIMARY_BY_THEME): string {
  const declarations = (primary: string, deep: string) =>
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
