// Responsive <picture> markup driven by src/lib/image-manifest.json, which
// bin/sync-content.mjs writes after optimizing each source image into AVIF +
// WebP variants. When an image is not in the manifest the helpers degrade to a
// plain <img> so nothing breaks.
import fs from 'node:fs';
import path from 'node:path';

type Variant = [number, string];
type ManifestEntry = {
  w: number;
  h: number;
  avif: Variant[];
  webp: Variant[];
  fallback: string;
};
type Manifest = Record<string, ManifestEntry>;

let manifestCache: Manifest | undefined;

function manifest(): Manifest {
  if (!manifestCache) {
    const file = path.resolve(process.cwd(), 'src/lib/image-manifest.json');
    try {
      manifestCache = JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
    } catch {
      manifestCache = {};
    }
  }
  return manifestCache;
}

/** Intrinsic width/height for an asset URL, or `undefined` if not in the manifest. */
export function getImageDimensions(src: string): { width: number; height: number } | undefined {
  const entry = manifest()[src];
  return entry ? { width: entry.w, height: entry.h } : undefined;
}

export type PictureOptions = {
  src: string;
  alt?: string;
  class?: string;
  sizes?: string;
  loading?: 'lazy' | 'eager';
  fetchpriority?: 'high' | 'low' | 'auto';
  /** Author display-width override (markdown `![alt|400](...)`). */
  width?: number | string;
};

const esc = (value: string): string => value.replace(/"/g, '&quot;');
const srcset = (variants: Variant[]): string =>
  variants.map(([w, url]) => `${url} ${w}w`).join(', ');

/** Build a responsive <picture>, or a plain <img> when the source is unknown. */
export function buildPicture(opts: PictureOptions): string {
  const { src, alt = '', loading = 'lazy', fetchpriority } = opts;
  const cls = opts.class ? ` class="${esc(opts.class)}"` : '';
  const fp = fetchpriority ? ` fetchpriority="${fetchpriority}"` : '';
  const altAttr = ` alt="${esc(String(alt))}"`;
  const entry = manifest()[src];

  if (!entry) {
    return `<img src="${src}"${altAttr}${cls} loading="${loading}" decoding="async"${fp}>`;
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
    `<source type="image/avif" srcset="${srcset(entry.avif)}" sizes="${sizes}">` +
    `<source type="image/webp" srcset="${srcset(entry.webp)}" sizes="${sizes}">` +
    `<img src="${entry.fallback}"${altAttr} width="${w}" height="${h}" ` +
    `loading="${loading}" decoding="async"${fp}${cls}>` +
    '</picture>'
  );
}

const IMG_TAG = /<img\b([^>]*)>/gi;
const ATTR = /([a-zA-Z][\w-]*)(?:="([^"]*)")?/g;

/** Rewrite every manifest-known <img> in an HTML string into a <picture>. */
export function enhanceImages(html: string, defaultSizes = '(max-width: 720px) 100vw, 672px'): string {
  return html.replace(IMG_TAG, (whole: string, attrString: string) => {
    const attrs: Record<string, string> = {};
    for (const match of attrString.matchAll(ATTR)) attrs[match[1].toLowerCase()] = match[2] ?? '';
    if (!attrs.src || !manifest()[attrs.src]) return whole;
    // `![alt|350](src)` survives as `alt="alt|350"` when the markdown reaches
    // us already-rendered (e.g., split-side inline images). Split it back out
    // so the width hint can drive the responsive sizes attribute.
    let alt = attrs.alt ?? '';
    let width = attrs.width;
    if (!width && alt.includes('|')) {
      const parts = alt.split('|').map((p) => p.trim());
      const widthPart = parts.slice(1).find((p) => /^\d+$/.test(p));
      if (widthPart) {
        alt = parts[0] ?? '';
        width = widthPart;
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
    });
  });
}
