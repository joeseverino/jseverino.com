// Responsive <picture> markup driven by src/lib/image-manifest.json, which
// bin/sync-content.ts writes after optimizing each source image into AVIF +
// WebP variants. A synced raster image missing from the manifest fails a
// production build; anything else (and any image in dev) degrades to a plain
// <img>.
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { parseImageDirectives } from './image-directives.ts';
import { contentRoot, fixtureContent } from './content-root.ts';
import { readJson } from './json.ts';

// One image-manifest.json entry: intrinsic size, [width, url] variants, the
// fallback URL. The sync writes it; the build reads it.
export type Variant = [width: number, url: string];
export interface ImageManifestEntry {
  w: number;
  h: number;
  avif: Variant[];
  webp: Variant[];
  fallback: string;
}
export type Manifest = Record<string, ImageManifestEntry>;

let manifestCache: Manifest | undefined;

function manifest(): Manifest {
  if (!manifestCache) {
    const file = fixtureContent
      ? path.resolve(process.cwd(), contentRoot, 'image-manifest.json')
      : path.resolve(process.cwd(), 'src/lib/image-manifest.json');
    try {
      manifestCache = readJson<Manifest>(file);
    } catch {
      manifestCache = {};
    }
  }
  return manifestCache;
}

// Raster images the sync owns: each must have a manifest entry.
const SYNCED_RASTER = /^\/assets\/(?:writeups|pages)\/.+\.(?:png|jpe?g)$/i;
const strictManifest = (): boolean =>
  import.meta.env?.PROD === true ||
  process.env.NODE_ENV === 'production' ||
  process.env.STRICT_IMAGE_MANIFEST === '1';

function requireEntry(src: string): void {
  if (SYNCED_RASTER.test(src) && strictManifest()) {
    throw new Error(`${src} is not in the image manifest; run the content sync (npm run sync:content) and commit its outputs`);
  }
}

/** Intrinsic width/height for an asset URL, or `undefined` if not in the manifest. */
export function getImageDimensions(src: string): { width: number; height: number } | undefined {
  const entry = manifest()[src];
  return entry ? { width: entry.w, height: entry.h } : undefined;
}

export type PictureOptions = {
  src: string;
  alt?: string | undefined;
  class?: string | undefined;
  sizes?: string | undefined;
  loading?: 'lazy' | 'eager' | undefined;
  fetchpriority?: 'high' | 'low' | 'auto' | undefined;
  /** Author display-width override (markdown `![alt|400](...)`). */
  width?: number | string | undefined;
  /** Opt this image out of the figure lightbox (markdown `![alt|nozoom](...)`). */
  noZoom?: boolean | undefined;
};

const { escapeHtml: esc, unescapeAll } = new MarkdownIt().utils;
const srcset = (variants: Variant[]): string =>
  variants.map(([w, url]) => `${esc(url)} ${w}w`).join(', ');

/** Build a responsive <picture>, or a plain <img> when the source is not a synced image. */
export function buildPicture(opts: PictureOptions): string {
  const { src, alt = '', loading = 'lazy', fetchpriority } = opts;
  const cls = opts.class ? ` class="${esc(opts.class)}"` : '';
  const fp = fetchpriority ? ` fetchpriority="${fetchpriority}"` : '';
  const altAttr = ` alt="${esc(String(alt))}"`;
  const nz = opts.noZoom ? ' data-no-zoom' : '';
  const entry = manifest()[src];

  if (!entry) {
    requireEntry(src);
    return `<img src="${esc(src)}"${altAttr}${cls} loading="${loading}" decoding="async"${fp}${nz}>`;
  }

  // Emit width/height so the browser reserves the box (no layout shift).
  // Honor an author display-width override, deriving height from the ratio
  // and using the same width to anchor the responsive sizes hint so the
  // browser stops picking a variant sized for the source instead of the slot.
  let w = entry.w;
  let h = entry.h;
  const displayWidth = Number(opts.width);
  const hasDisplayWidth = Number.isFinite(displayWidth) && displayWidth > 0;
  if (hasDisplayWidth) {
    w = displayWidth;
    h = Math.round((displayWidth * entry.h) / entry.w);
  }
  const sizes = opts.sizes ?? (hasDisplayWidth ? `(min-width: 600px) ${displayWidth}px, 100vw` : '100vw');

  return (
    '<picture>' +
    `<source type="image/avif" srcset="${srcset(entry.avif)}" sizes="${esc(sizes)}">` +
    `<source type="image/webp" srcset="${srcset(entry.webp)}" sizes="${esc(sizes)}">` +
    `<img src="${esc(entry.fallback)}"${altAttr} width="${w}" height="${h}" ` +
    `loading="${loading}" decoding="async"${fp}${cls}${nz}>` +
    '</picture>'
  );
}

const IMG_TAG = /<img\b([^>]*)>/gi;
const ATTR = /([a-zA-Z][\w-]*)(?:="([^"]*)")?/g;

/** Rewrite every manifest-known <img> in an HTML string into a <picture>. */
export function enhanceImages(html: string, defaultSizes = '(max-width: 720px) 100vw, 672px'): string {
  return html.replace(IMG_TAG, (whole: string, attrString: string) => {
    const attrs: Record<string, string> = {};
    for (const match of attrString.matchAll(ATTR)) {
      const [, name = '', value = ''] = match;
      attrs[name.toLowerCase()] = unescapeAll(value);
    }
    if (!attrs.src) return whole;
    if (!manifest()[attrs.src]) {
      requireEntry(attrs.src);
      return whole;
    }
    // `![alt|350](src)` survives as `alt="alt|350"` when the markdown reaches
    // us already-rendered (e.g., split-side inline images). Split it back out
    // so the width hint can drive the responsive sizes attribute.
    let alt = attrs.alt ?? '';
    let width = attrs.width;
    if (!width && alt.includes('|')) {
      const directive = parseImageDirectives(alt);
      if (directive.width) {
        alt = directive.alt;
        width = directive.width;
      }
    }
    const sizes = width ? undefined : defaultSizes;
    return buildPicture({
      src: attrs.src,
      alt,
      class: attrs.class,
      width,
      sizes,
      loading: attrs.loading === 'eager' ? 'eager' : 'lazy',
      fetchpriority: attrs.fetchpriority === 'high' ? 'high' : undefined,
      noZoom: 'data-no-zoom' in attrs,
    });
  });
}
