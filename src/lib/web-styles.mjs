// The "load BOTH" contract, encoded once.
//
// A consumer that embeds the site's writeup styling outside the site (the
// Obsidian plugin's preview pane, any future tool) needs THREE things TOGETHER:
//
//   1. base.css           — the design system (tables, links, buttons, prose)
//   2. the brand vars      — --color-primary / --color-primary-deep. These are
//                            NOT in base.css; the site loads them from /brand.css.
//                            base.css's tinted tables, zebra stripes, header
//                            underline, links, and buttons all read --color-primary,
//                            so base.css ALONE renders dead without them.
//   3. the Inter @font-face — base.css references Inter by name; the embedder must
//                             supply a resolvable font URL (an inlined data URI in
//                             an iframe, an absolute URL on the site).
//
// Missing #2 is the trap that cost a debugging session. This helper hands back
// all three as one <style> blob so an embedder calls ONE function and cannot
// forget the brand vars. base.css and the font are passed in because each
// embedder obtains them its own way (esbuild text/dataurl import, a fetch, a
// file read); only the assembly is shared.
import { brandVarsCss } from './brand.mjs';

export function previewStyles({ baseCss, fontUrl }) {
  return [
    `<style>${brandVarsCss()}</style>`,
    `<style>${baseCss}</style>`,
    `<style>@font-face{font-family:Inter;font-weight:100 900;font-style:normal;font-display:swap;src:url(${fontUrl}) format('woff2')}</style>`,
  ].join('\n');
}
