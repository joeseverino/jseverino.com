// Local asset references in vault markdown: find them, resolve them inside the
// source folder, rewrite them to their public URL, and encode the raster ones
// into responsive variants. The collector and the rewriter share one pattern
// set, so every reference the sync copies is exactly one it rewrites.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import sharp from 'sharp';
import type { Writer } from './writer.ts';
import type { ImageManifestEntry, Variant } from '../../src/lib/images.ts';
import { isExternal } from '../../src/lib/refs.ts';

// 768 exists because the common CSS box for a page/writeup image (a split
// column, a project card at high device-pixel-ratio) needs 600-720px of real
// pixels: the 512 tier undersizes it and the 1024 tier ships roughly double
// the bytes for no visible gain.
export const VARIANT_WIDTHS = [512, 768, 1024, 1600];
export const OPTIMIZABLE = /\.(?:png|jpe?g)$/i;
// Encoded bytes depend on the native toolchain as well as the source, so the
// lineage is part of every cache key: a sharp/libvips upgrade re-encodes.
export const IMAGE_ENCODER_LINEAGE = `sharp-${sharp.versions.sharp}-vips-${sharp.versions.vips}`;

const TITLE = String.raw`(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?`;
const DESTINATION = String.raw`(<[^>\n]*>|[^)\s]+)`;
// Link text may hold one level of brackets, so [![img](a)](b) yields both a and b.
const TEXT = String.raw`(?:[^\[\]\n]|\[[^\]\n]*\])*`;

// Each pattern captures the destination as group 1.
const REFERENCE_PATTERNS = [
  new RegExp(String.raw`!\[${TEXT}\]\(\s*${DESTINATION}${TITLE}\s*\)`, 'g'),
  new RegExp(String.raw`(?<!!)\[${TEXT}\]\(\s*${DESTINATION}${TITLE}\s*\)`, 'g'),
  new RegExp(String.raw`^ {0,3}\[[^\]\n]+\]:[ \t]*${DESTINATION}`, 'gm'),
  /\b(?:src|href)\s*=\s*["']([^"']+)["']/g,
];

const unwrap = (destination: string): string => destination.replace(/^<(.*)>$/, '$1');

// The folder-relative path (`images/...`) a destination names, or undefined
// when it is external, an anchor, or a site-absolute path.
export function normalizeLocalAssetRef(destination: unknown): string | undefined {
  if (typeof destination !== 'string' || !destination.trim()) return undefined;
  const ref = unwrap(destination.trim());
  if (isExternal(ref)) return undefined;
  const [withoutHash = ''] = ref.split('#');
  const [withoutQuery = ''] = withoutHash.split('?');
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    decoded = withoutQuery;
  }
  return decoded.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '') || undefined;
}

// Every relative reference in a body: { ref, raw } where ref is normalized.
export interface Reference {
  ref: string;
  raw: string;
}

export function collectReferences(markdown: string): Reference[] {
  const found = new Map<string, string>();
  for (const pattern of REFERENCE_PATTERNS) {
    for (const [, raw = ''] of markdown.matchAll(pattern)) {
      const ref = normalizeLocalAssetRef(raw);
      if (ref && !found.has(ref)) found.set(ref, raw);
    }
  }
  return [...found].map(([ref, raw]) => ({ ref, raw }));
}

// The asset references the sync copies: relative refs under images/.
export const isAssetRef = (ref: string): boolean => ref.startsWith('images/');

// Relative references the sync cannot carry: they would 404 on the site.
// site validate reports them; the sync refuses them the same way.
export const STRAY_REFERENCE = 'relative reference outside images/ will not resolve on the site';
export const strayReferences = (markdown: string): Reference[] => collectReferences(markdown).filter(({ ref }) => !isAssetRef(ref));

export function collectAssetRefs(markdown: string): Set<string> {
  return new Set(collectReferences(markdown).map(({ ref }) => ref).filter(isAssetRef));
}

// A destination rewritten to the public URL, preserving query and fragment.
function rewriteDestination(destination: string, urlPrefix: string): string {
  const ref = normalizeLocalAssetRef(destination);
  if (!ref || !isAssetRef(ref)) return destination;
  const bare = unwrap(destination.trim());
  const tail = bare.slice(bare.indexOf('images/'));
  const url = `${urlPrefix}/${tail}`;
  return destination.trim().startsWith('<') ? `<${url}>` : url;
}

// Splices by capture index, so alt text or a title that repeats the
// destination is never the part rewritten.
export function rewriteAssetUrls(markdown: string, urlPrefix: string): string {
  let rewritten = markdown;
  for (const pattern of REFERENCE_PATTERNS) {
    const withIndices = new RegExp(pattern.source, `${pattern.flags}d`);
    const edits = [...rewritten.matchAll(withIndices)]
      .flatMap((match) => {
        // The d flag guarantees indices; group 1 always participates.
        const span = match.indices?.[1];
        const original = match[1];
        return span && original !== undefined ? [{ span, replacement: rewriteDestination(original, urlPrefix), original }] : [];
      })
      .filter(({ replacement, original }) => replacement !== original);
    for (const { span: [start, end], replacement } of edits.reverse()) {
      rewritten = `${rewritten.slice(0, start)}${replacement}${rewritten.slice(end)}`;
    }
  }
  return rewritten;
}

// cover_image in frontmatter, rewritten the same way as body references.
export function rewriteAssetUrl<T>(value: T, urlPrefix: string): T | string {
  return typeof value === 'string' && value.trim() ? rewriteDestination(value, urlPrefix) : value;
}

// The absolute source path for a ref, refusing anything that escapes the
// folder (`images/../../secret.md`).
export function resolveAssetSource(sourceDir: string, ref: string): string {
  const source = path.resolve(sourceDir, ref);
  if (!source.startsWith(sourceDir + path.sep)) {
    throw new Error(`asset outside its source folder: ${ref}`);
  }
  return source;
}

// Every problem with a body's references and its cover, without touching disk
// beyond existence checks. Returns human-readable issue strings.
export async function referenceIssues(markdown: string, sourceDir: string, { cover }: { cover?: unknown } = {}): Promise<string[]> {
  const issues: string[] = [];
  const refs = collectReferences(markdown);
  const coverRef = normalizeLocalAssetRef(cover);
  if (cover && !coverRef && !isExternal(String(cover))) issues.push(`cover_image is empty or unreadable: ${cover}`);
  if (coverRef) refs.push({ ref: coverRef, raw: `cover_image ${String(cover)}` });
  for (const { ref, raw } of refs) {
    if (!isAssetRef(ref)) {
      issues.push(`${STRAY_REFERENCE}: ${raw}`);
      continue;
    }
    let source: string;
    try {
      source = resolveAssetSource(sourceDir, ref);
    } catch (error) {
      issues.push((error as Error).message);
      continue;
    }
    try {
      await fs.access(source);
    } catch {
      issues.push(`missing image: ${ref}`);
    }
  }
  for (const match of markdown.matchAll(/!?\[\[[^\]\n]+\]\]/g)) {
    issues.push(`Obsidian wikilink does not render on the site: ${match[0]}`);
  }
  return issues;
}

// Run fn over items with at most `limit` in flight.
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      // index < items.length, checked above.
      results[index] = await fn(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

// Image encodes in flight: one per core, within half the machine's memory. A
// cold sync of this site peaks near 1.1 GB at eight encodes (about 120 MB
// each); IMAGE_JOB_BYTES doubles that for headroom on larger sources.
const IMAGE_JOB_BYTES = 256 * 2 ** 20;
export const defaultConcurrency = (): number =>
  Math.max(1, Math.min(os.availableParallelism(), Math.floor(os.totalmem() / 2 / IMAGE_JOB_BYTES)));

// Encodes one source image into AVIF/WebP variants plus a resized fallback at
// the source's own path, through a content-addressed cache. Returns the
// manifest entry; every file it writes goes through the writer.
export type ImageEncoder = (source: string, target: string, url: string) => Promise<ImageManifestEntry>;

export function createImageEncoder({ cacheDir, writer }: { cacheDir: string; writer: Pick<Writer, 'write'> }): ImageEncoder {
  // Each source is encoded once, so libvips' operation cache only holds memory.
  // Its thread pool stays at the default: the thread count changes AVIF bytes,
  // and the committed variants are the default's output.
  sharp.cache(false);
  const lineageDir = path.join(cacheDir, IMAGE_ENCODER_LINEAGE);

  async function emit(outFile: string, cacheName: string, encode: () => Promise<Buffer>): Promise<void> {
    const cacheFile = path.join(lineageDir, cacheName);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(cacheFile);
    } catch {
      bytes = await encode();
      await fs.mkdir(lineageDir, { recursive: true });
      // Through a temp file and a rename, so an interrupted sync never leaves
      // a truncated variant that a later run would read as cached.
      const temp = `${cacheFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temp, bytes);
      await fs.rename(temp, cacheFile);
    }
    await writer.write(outFile, bytes);
  }

  return async function encodeImage(source, target, url) {
    const buffer = await fs.readFile(source);
    const meta = await sharp(buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) throw new Error(`unreadable image dimensions: ${url}`);

    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const dir = path.dirname(target);
    const ext = path.extname(target);
    const base = path.basename(target, ext);
    const urlDir = url.slice(0, url.lastIndexOf('/'));
    const maxWidth = Math.max(...VARIANT_WIDTHS);
    const widths = [
      ...new Set([...VARIANT_WIDTHS.filter((w) => w < width), Math.min(width, maxWidth)]),
    ].sort((a, b) => a - b);

    const avif: Variant[] = [];
    const webp: Variant[] = [];
    for (const w of widths) {
      await emit(path.join(dir, `${base}-${w}.avif`), `${hash}-${w}.avif`, () =>
        sharp(buffer).resize({ width: w }).avif({ quality: 60 }).toBuffer());
      await emit(path.join(dir, `${base}-${w}.webp`), `${hash}-${w}.webp`, () =>
        sharp(buffer).resize({ width: w }).webp({ quality: 82 }).toBuffer());
      avif.push([w, `${urlDir}/${base}-${w}.avif`]);
      webp.push([w, `${urlDir}/${base}-${w}.webp`]);
    }
    await emit(target, `${hash}-fallback${ext}`, () => {
      const pipeline = sharp(buffer).resize({ width: Math.min(width, maxWidth), withoutEnlargement: true });
      return (ext.toLowerCase() === '.png'
        ? pipeline.png({ compressionLevel: 9 })
        : pipeline.jpeg({ quality: 82 })).toBuffer();
    });

    return { w: width, h: height, avif, webp, fallback: url };
  };
}
