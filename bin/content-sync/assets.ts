// Local asset references in vault markdown: find them, resolve them inside the
// source folder, and write each image's master beside its document, where
// Astro's image pipeline encodes the variants.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { defineMdastPlugin, htmlToHast, markdownToHtml, type HastNode } from 'satteri';
import sharp from 'sharp';
import { features } from '../../src/lib/markdown/index.ts';
import { isExternal } from '../../src/lib/refs.ts';
import { errorMessage } from '../../src/lib/error-message.ts';

// The folder-relative path (`images/...`) a destination names, or undefined
// when it is external, an anchor, or a site-absolute path.
export function normalizeLocalAssetRef(destination: unknown): string | undefined {
  if (typeof destination !== 'string' || !destination.trim()) return undefined;
  const ref = destination.trim();
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

// The src and href of every element in a raw HTML fragment.
function* htmlDestinations(node: HastNode): Generator<string> {
  if (node.type === 'element') {
    for (const name of ['src', 'href']) {
      const value = node.properties[name];
      if (typeof value === 'string') yield value;
    }
  }
  if ('children' in node) for (const child of node.children) yield* htmlDestinations(child);
}

// Vault sources are Obsidian Markdown, so they parse as Markdown with the
// site's features: code is skipped, and raw HTML is read as HTML.
export function collectReferences(markdown: string): Reference[] {
  const destinations: string[] = [];
  const collector = defineMdastPlugin({
    name: 'collect-references',
    link: ({ url }) => void destinations.push(url),
    image: ({ url }) => void destinations.push(url),
    definition: ({ url }) => void destinations.push(url),
    html: ({ value }) => void destinations.push(...htmlDestinations(htmlToHast(value, { fragment: true }))),
  });
  markdownToHtml(markdown, { features, mdastPlugins: [collector] });
  const found = new Map<string, string>();
  for (const raw of destinations) {
    const ref = normalizeLocalAssetRef(raw);
    if (ref && !found.has(ref)) found.set(ref, raw);
  }
  return [...found].map(([ref, raw]) => ({ ref, raw }));
}

// The asset references the sync copies: relative refs under images/.
const isAssetRef = (ref: string): boolean => ref.startsWith('images/');

// Relative references the sync cannot carry: they would 404 on the site.
// site validate reports them; the sync refuses them the same way.
export const STRAY_REFERENCE = 'relative reference outside images/ will not resolve on the site';
export const strayReferences = (markdown: string): Reference[] => collectReferences(markdown).filter(({ ref }) => !isAssetRef(ref));

export function collectAssetRefs(markdown: string): Set<string> {
  return new Set(collectReferences(markdown).map(({ ref }) => ref).filter(isAssetRef));
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
      issues.push(errorMessage(error));
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

// Encodes in flight: one per core, within half of memory (an encode peaks near 120 MB).
const IMAGE_JOB_BYTES = 256 * 2 ** 20;
export const defaultConcurrency = (): number =>
  Math.max(1, Math.min(os.availableParallelism(), Math.floor(os.totalmem() / 2 / IMAGE_JOB_BYTES)));

// Masters committed beside each document: at most MASTER_WIDTH wide, sRGB, all metadata (EXIF, XMP, ICC)
// dropped so nothing the camera or screenshot tool wrote reaches the public repo.
export const MASTER_WIDTH = 1600;
// Encoded bytes depend on the toolchain as well as the source, so the lineage
// is part of each cache key: a sharp or libvips upgrade re-encodes.
const MASTER_LINEAGE = `master-${MASTER_WIDTH}-sharp-${sharp.versions.sharp}-vips-${sharp.versions.vips}`;

type MasterEncoder = (source: string) => Promise<Buffer>;

export function createMasterEncoder(cacheDir: string): MasterEncoder {
  const dir = path.join(cacheDir, MASTER_LINEAGE);
  return async (source) => {
    const input = await fs.readFile(source);
    const ext = path.extname(source).toLowerCase();
    const cacheFile = path.join(dir, `${crypto.createHash('sha256').update(input).digest('hex')}${ext}`);
    try {
      return await fs.readFile(cacheFile);
    } catch {
      const pipeline = sharp(input).rotate().resize({ width: MASTER_WIDTH, withoutEnlargement: true });
      const output = await (ext === '.png' ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 90, mozjpeg: true })).toBuffer();
      await fs.mkdir(dir, { recursive: true });
      // Through a temp file and a rename, so an interrupted sync never leaves a
      // truncated master that a later run would read as cached.
      const temp = `${cacheFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temp, output);
      await fs.rename(temp, cacheFile);
      return output;
    }
  };
}
