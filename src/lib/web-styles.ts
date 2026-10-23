// The Inter @font-face base.css expects, for the font URL each caller supplies.
export const interFontFace = (fontUrl: string): string =>
  `@font-face{font-family:Inter;font-weight:400 700;font-style:normal;font-display:swap;src:url(${fontUrl}) format('woff2')}`;
