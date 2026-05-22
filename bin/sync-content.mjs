#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import sharp from 'sharp';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vaultRoot = process.env.VAULT_DIR
  ? path.resolve(process.env.VAULT_DIR)
  : path.resolve(siteRoot, '../../Severino Labs');

// --drafts also syncs `published: false` pages and writeups, for local preview
// only. They render in `astro dev` but the production build still excludes them
// (see getWriteups/getPage in src/lib/content.ts).
const includeDrafts = process.argv.includes('--drafts');

const sourcePages = path.join(vaultRoot, '06 Pages');
const sourceWriteups = path.join(vaultRoot, '05 Writeups');
const targetPages = path.join(siteRoot, 'src/content/pages');
const targetSite = path.join(siteRoot, 'src/content/site.md');
const targetTechnologyGroups = path.join(siteRoot, 'src/content/technology-groups.md');
const targetWriteups = path.join(siteRoot, 'src/content/writeups');
const targetWriteupAssets = path.join(siteRoot, 'public/assets/writeups');
const targetPageAssets = path.join(siteRoot, 'public/assets/pages');
const targetImageManifest = path.join(siteRoot, 'src/lib/image-manifest.json');
const imageCacheDir = path.join(siteRoot, 'node_modules/.cache/jseverino-img');

// Responsive variant widths (px). Each image gets AVIF + WebP at every width
// at or below its own, plus a re-encoded raster fallback at the original path.
const VARIANT_WIDTHS = [512, 1024, 1600];
const imageManifest = {};

function emptyDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function normalizeLocalAssetRef(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return undefined;
  if (/^(?:https?:)?\/\//.test(ref)) return undefined;
  if (ref.startsWith('#') || ref.startsWith('data:') || ref.startsWith('mailto:')) return undefined;

  const withoutHash = ref.split('#')[0];
  const withoutQuery = withoutHash.split('?')[0];
  const decoded = decodeURIComponent(withoutQuery)
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');

  const imagesIndex = decoded.indexOf('images/');
  if (imagesIndex === -1) return undefined;
  return decoded.slice(imagesIndex);
}

function collectMarkdownAssetRefs(markdown) {
  const refs = new Set();
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const ref = normalizeLocalAssetRef(match[1]);
    if (ref) refs.add(ref);
  }
  for (const match of markdown.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const ref = normalizeLocalAssetRef(match[1]);
    if (ref) refs.add(ref);
  }
  for (const match of markdown.matchAll(/\bsrc=["']([^"']+)["']/g)) {
    const ref = normalizeLocalAssetRef(match[1]);
    if (ref) refs.add(ref);
  }
  return refs;
}

const OPTIMIZABLE = /\.(?:png|jpe?g)$/i;

// Generate AVIF + WebP variants for one image, plus a capped raster fallback at
// the original path. Encoded outputs are cached by source-content hash, so a
// re-sync only re-encodes images that actually changed.
async function optimizeImage(source, target, url) {
  try {
    const buffer = fs.readFileSync(source);
    const meta = await sharp(buffer).metadata();
    const intrinsicW = meta.width ?? 0;
    const intrinsicH = meta.height ?? 0;
    if (!intrinsicW || !intrinsicH) throw new Error('unreadable dimensions');

    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const dir = path.dirname(target);
    const ext = path.extname(target);
    const base = path.basename(target, ext);
    const urlDir = url.slice(0, url.lastIndexOf('/'));
    fs.mkdirSync(dir, { recursive: true });

    const maxWidth = VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
    const widths = [
      ...new Set([
        ...VARIANT_WIDTHS.filter((width) => width < intrinsicW),
        Math.min(intrinsicW, maxWidth),
      ]),
    ].sort((a, b) => a - b);

    // Copy from cache when the encoded output already exists; otherwise encode.
    const emit = async (outName, cacheName, encode) => {
      const outFile = path.join(dir, outName);
      const cacheFile = path.join(imageCacheDir, cacheName);
      if (fs.existsSync(cacheFile)) {
        fs.copyFileSync(cacheFile, outFile);
      } else {
        fs.writeFileSync(outFile, await encode());
        fs.copyFileSync(outFile, cacheFile);
      }
    };

    const avif = [];
    const webp = [];
    for (const width of widths) {
      const avifName = `${base}-${width}.avif`;
      const webpName = `${base}-${width}.webp`;
      await emit(avifName, `${hash}-${width}.avif`, () =>
        sharp(buffer).resize({ width }).avif({ quality: 60 }).toBuffer(),
      );
      await emit(webpName, `${hash}-${width}.webp`, () =>
        sharp(buffer).resize({ width }).webp({ quality: 82 }).toBuffer(),
      );
      avif.push([width, `${urlDir}/${avifName}`]);
      webp.push([width, `${urlDir}/${webpName}`]);
    }

    // Raster fallback at the original path — capped, re-encoded, never upscaled.
    await emit(path.basename(target), `${hash}-fallback${ext}`, () => {
      const pipeline = sharp(buffer).resize({
        width: Math.min(intrinsicW, maxWidth),
        withoutEnlargement: true,
      });
      return (
        /\.png$/i.test(ext) ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 82 })
      ).toBuffer();
    });

    imageManifest[url] = { w: intrinsicW, h: intrinsicH, avif, webp, fallback: url };
  } catch (error) {
    console.warn(`[images] could not optimize ${url} (${error.message}); copying original`);
    copyFile(source, target);
  }
}

async function processReferencedAssets(refs, sourceDir, targetDir, urlPrefix) {
  for (const ref of refs) {
    const source = path.resolve(sourceDir, ref);
    const target = path.resolve(targetDir, ref);

    if (!source.startsWith(sourceDir + path.sep)) {
      throw new Error(`Refusing to copy asset outside source directory: ${ref}`);
    }
    if (!fs.existsSync(source)) {
      throw new Error(`Missing referenced asset: ${source}`);
    }

    if (OPTIMIZABLE.test(ref)) {
      await optimizeImage(source, target, `${urlPrefix}/${ref}`);
    } else {
      copyFile(source, target);
    }
  }
}

function publicWriteupData(data) {
  return {
    title: data.title,
    description: data.description,
    published: data.published === true,
    ...(data.published_at ? { published_at: data.published_at } : {}),
    ...(data.last_reviewed ? { last_reviewed: data.last_reviewed } : {}),
    ...(data.cover_image ? { cover_image: data.cover_image } : {}),
    technologies: Array.isArray(data.technologies) ? data.technologies : [],
    featured: Boolean(data.featured),
    ...(Number.isInteger(data.featured_order) ? { featured_order: data.featured_order } : {}),
  };
}

function publicPageData(data) {
  return {
    title: data.title,
    ...(data.description ? { description: data.description } : {}),
    path: data.path,
    published: data.published === true,
  };
}

function rewritePageAssetPaths(markdown, slug) {
  return markdown
    .replaceAll('./images/', `/assets/pages/${slug}/images/`)
    .replaceAll('](images/', `](/assets/pages/${slug}/images/`)
    .replaceAll('src="./images/', `src="/assets/pages/${slug}/images/`)
    .replaceAll('src="images/', `src="/assets/pages/${slug}/images/`);
}

function rewriteWriteupAssetPaths(markdown, slug) {
  return markdown
    .replaceAll('./images/', `/assets/writeups/${slug}/images/`)
    .replaceAll('](images/', `](/assets/writeups/${slug}/images/`)
    .replace(/^```\s*(?:wp-block-code|source-code-block|cli-block)$/gm, '```text');
}

// Strip HTML-tag-like sequences. A single `/<[^>]+>/` pass is incomplete:
// removing one match can splice the neighbouring characters into a fresh
// tag-like sequence the pass already moved past. Loop to a fixpoint so
// nothing tag-shaped can survive.
function stripHtmlTags(value) {
  let current = value;
  let previous;
  do {
    previous = current;
    current = current.replace(/<[^>]+>/g, '');
  } while (current !== previous);
  return current;
}

function normalizeDescription(text) {
  const withoutMarkdownLinks = text
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '');

  return stripHtmlTags(withoutMarkdownLinks)
    .replace(/\\$/gm, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripRepeatedDescription(markdown, description) {
  if (typeof description !== 'string' || !description.trim()) return markdown;

  const expected = normalizeDescription(description);
  const lines = markdown.split(/\r?\n/);
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const isCandidate =
      (trimmed.startsWith('>') || trimmed.startsWith('[') || /^[A-Z0-9]/.test(trimmed)) &&
      output.some((previous) => /^#\s+/.test(previous.trim()));

    if (!isCandidate) {
      output.push(line);
      index += 1;
      continue;
    }

    const start = index;
    const candidate = [];
    while (index < lines.length && lines[index].trim() !== '') {
      candidate.push(lines[index]);
      index += 1;
    }

    const text = normalizeDescription(candidate.join(' ').replace(/^>\s?/gm, ''));
    if (text === expected) {
      while (index < lines.length && lines[index].trim() === '') index += 1;
      continue;
    }

    output.push(...lines.slice(start, index));
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

async function syncPages() {
  if (!fs.existsSync(sourcePages)) {
    throw new Error(`Missing vault pages directory: ${sourcePages}`);
  }

  emptyDir(targetPages);
  emptyDir(targetPageAssets);

  for (const entry of fs.readdirSync(sourcePages, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === '_site.md') {
      copyFile(path.join(sourcePages, entry.name), targetSite);
      continue;
    }
    if (entry.isFile() && entry.name === '_technology-groups.md') {
      copyFile(path.join(sourcePages, entry.name), targetTechnologyGroups);
      continue;
    }
    if (entry.isFile() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

    const slug = entry.name;
    const sourceDir = path.join(sourcePages, slug);
    const sourceIndex = path.join(sourceDir, 'index.md');
    if (!fs.existsSync(sourceIndex)) continue;

    const parsed = matter(fs.readFileSync(sourceIndex, 'utf8'));
    if (!includeDrafts && parsed.data.published !== true) continue;

    const refs = collectMarkdownAssetRefs(parsed.content);
    const rewrittenBody = rewritePageAssetPaths(parsed.content, slug);
    const synced = matter.stringify(rewrittenBody, publicPageData(parsed.data));

    fs.mkdirSync(targetPages, { recursive: true });
    fs.writeFileSync(path.join(targetPages, `${slug}.md`), synced);

    await processReferencedAssets(
      refs,
      sourceDir,
      path.join(targetPageAssets, slug),
      `/assets/pages/${slug}`,
    );
  }
}

async function syncWriteups() {
  emptyDir(targetWriteups);
  emptyDir(targetWriteupAssets);

  for (const entry of fs.readdirSync(sourceWriteups, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const slug = entry.name;
    const sourceDir = path.join(sourceWriteups, slug);
    const sourceIndex = path.join(sourceDir, 'index.md');
    if (!fs.existsSync(sourceIndex)) continue;

    const parsed = matter(fs.readFileSync(sourceIndex, 'utf8'));
    if (!includeDrafts && parsed.data.published !== true) continue;

    const content = stripRepeatedDescription(parsed.content, parsed.data.description);
    const refs = collectMarkdownAssetRefs(content);
    const coverRef = normalizeLocalAssetRef(parsed.data.cover_image);
    if (coverRef) refs.add(coverRef);

    const rewrittenContent = rewriteWriteupAssetPaths(content, slug);
    const syncedMarkdown = matter.stringify(rewrittenContent, publicWriteupData(parsed.data));

    const targetDir = path.join(targetWriteups, slug);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'index.md'), syncedMarkdown);

    await processReferencedAssets(
      refs,
      sourceDir,
      path.join(targetWriteupAssets, slug),
      `/assets/writeups/${slug}`,
    );
  }
}

fs.mkdirSync(imageCacheDir, { recursive: true });
await syncPages();
await syncWriteups();

const sortedManifest = Object.fromEntries(
  Object.keys(imageManifest)
    .sort()
    .map((key) => [key, imageManifest[key]]),
);
fs.mkdirSync(path.dirname(targetImageManifest), { recursive: true });
fs.writeFileSync(targetImageManifest, `${JSON.stringify(sortedManifest, null, 2)}\n`);

console.log(`Synced pages from ${sourcePages}`);
console.log(`Synced public writeups from ${sourceWriteups}`);
console.log(
  `Optimized ${Object.keys(imageManifest).length} images → ${path.relative(siteRoot, targetImageManifest)}`,
);

if (includeDrafts) {
  console.log(
    'Included drafts (published: false) — local preview only; do not commit or publish this sync.',
  );
}
