// Styles for embedding writeup content outside the site: the brand vars, base.css, and the
// Inter @font-face. base.css and the font URL come from the embedder, which obtains them its own way.
import { brandVarsCss } from './brand.ts';

// The Inter rule base.css expects, for a font URL the embedder resolves.
export const interFontFace = (fontUrl: string): string =>
  `@font-face{font-family:Inter;font-weight:400 700;font-style:normal;font-display:swap;src:url(${fontUrl}) format('woff2')}`;

export function previewStyles({ baseCss, fontUrl }: { baseCss: string; fontUrl: string }): string {
  return [
    `<style>${brandVarsCss()}</style>`,
    `<style>${baseCss}</style>`,
    `<style>${interFontFace(fontUrl)}</style>`,
  ].join('\n');
}
