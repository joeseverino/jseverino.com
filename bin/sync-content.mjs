#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import sharp from 'sharp';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vaultRoot = process.env.VAULT_DIR
  ? path.resolve(process.env.VAULT_DIR)
  : path.resolve(siteRoot, '../../Severino Labs');

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
const syncManifestPath = path.join(siteRoot, 'node_modules/.cache/jseverino-sync-manifest.json');
const imageCacheDir = path.join(siteRoot, 'node_modules/.cache/jseverino-img');

const VARIANT_WIDTHS = [512, 1024, 1600];
const imageManifest = {};
let syncManifest = {};

try {
  syncManifest = JSON.parse(fs.readFileSync(syncManifestPath, 'utf8'));
} catch {
  syncManifest = {};
}

const today = new Date().toISOString().slice(0, 10);

async function emptyDir(dir) {
  await fsPromises.rm(dir, { recursive: true, force: true });
  await fsPromises.mkdir(dir, { recursive: true });
}

async function copyFile(source, target) {
  await fsPromises.mkdir(path.dirname(target), { recursive: true });
  await fsPromises.copyFile(source, target);
}

function normalizeLocalAssetRef(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return undefined;
  if (/^(?:https?:)?\/\//.test(ref)) return undefined;
  if (ref.startsWith('#') || ref.startsWith('data:') || ref.startsWith('mailto:')) return undefined;

  const [withoutHash] = ref.split('#');
  const [withoutQuery] = withoutHash.split('?');
  const decoded = decodeURIComponent(withoutQuery)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');

  const imagesIndex = decoded.indexOf('images/');
  if (imagesIndex === -1) return undefined;
  return decoded.slice(imagesIndex);
}

function collectMarkdownAssetRefs(markdown) {
  const refs = new Set();
  const patterns = [
    /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    /\bsrc=["']([^"']+)["']/g
  ];

  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      const ref = normalizeLocalAssetRef(match[1]);
      if (ref) refs.add(ref);
    }
  }
  return refs;
}

const OPTIMIZABLE = /\.(?:png|jpe?g)$/i;

async function optimizeImage(source, target, url) {
  try {
    const buffer = await fsPromises.readFile(source);
    const meta = await sharp(buffer).metadata();
    const intrinsicW = meta.width ?? 0;
    const intrinsicH = meta.height ?? 0;
    if (!intrinsicW || !intrinsicH) throw new Error('unreadable dimensions');

    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const dir = path.dirname(target);
    const ext = path.extname(target);
    const base = path.basename(target, ext);
    const urlDir = url.slice(0, url.lastIndexOf('/'));
    await fsPromises.mkdir(dir, { recursive: true });

    const maxWidth = VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
    const widths = [
      ...new Set([
        ...VARIANT_WIDTHS.filter((width) => width < intrinsicW),
        Math.min(intrinsicW, maxWidth),
      ]),
    ].sort((a, b) => a - b);

    const emit = async (outName, cacheName, encode) => {
      const outFile = path.join(dir, outName);
      const cacheFile = path.join(imageCacheDir, cacheName);
      try {
        await fsPromises.access(cacheFile);
        await fsPromises.copyFile(cacheFile, outFile);
      } catch {
        const encoded = await encode();
        await fsPromises.writeFile(outFile, encoded);
        await fsPromises.copyFile(outFile, cacheFile);
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

    await emit(path.basename(target), `${hash}-fallback${ext}`, () => {
      const pipeline = sharp(buffer).resize({
        width: Math.min(intrinsicW, maxWidth),
        withoutEnlargement: true,
      });
      return (
        ext.toLowerCase() === '.png' ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 82 })
      ).toBuffer();
    });

    imageManifest[url] = { w: intrinsicW, h: intrinsicH, avif, webp, fallback: url };
  } catch (error) {
    console.warn(`[images] could not optimize ${url} (${error.message}); copying original`);
    await copyFile(source, target);
  }
}

async function processReferencedAssets(refs, sourceDir, targetDir, urlPrefix) {
  for (const ref of refs) {
    const source = path.resolve(sourceDir, ref);
    const target = path.resolve(targetDir, ref);

    if (!source.startsWith(sourceDir + path.sep)) {
      throw new Error(`Refusing to copy asset outside source directory: ${ref}`);
    }
    try {
      await fsPromises.access(source);
    } catch {
      throw new Error(`Missing referenced asset: ${source}`);
    }

    if (OPTIMIZABLE.test(ref)) {
      await optimizeImage(source, target, `${urlPrefix}/${ref}`);
    } else {
      await copyFile(source, target);
    }
  }
}

function publicWriteupData(data, contentHash, slug) {
  const isChanged = syncManifest[slug] !== contentHash;
  const lastReviewed = isChanged ? today : data.last_reviewed || data.published_at || today;

  if (isChanged) {
    syncManifest[slug] = contentHash;
  }

  return {
    title: data.title,
    description: data.description,
    published: data.published === true,
    ...(data.published_at ? { published_at: data.published_at } : {}),
    last_reviewed: lastReviewed,
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
  const entries = await fsPromises.readdir(sourcePages, { withFileTypes: true });
  await emptyDir(targetPages);
  await emptyDir(targetPageAssets);

  for (const entry of entries) {
    if (entry.isFile() && entry.name === '_site.md') {
      await copyFile(path.join(sourcePages, entry.name), targetSite);
      continue;
    }
    if (entry.isFile() && entry.name === '_technology-groups.md') {
      await copyFile(path.join(sourcePages, entry.name), targetTechnologyGroups);
      continue;
    }
    if (entry.isFile() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

    const slug = entry.name;
    const sourceDir = path.join(sourcePages, slug);
    const sourceIndex = path.join(sourceDir, 'index.md');
    try {
      await fsPromises.access(sourceIndex);
    } catch {
      continue;
    }

    const raw = await fsPromises.readFile(sourceIndex, 'utf8');
    const parsed = matter(raw);
    if (!includeDrafts && parsed.data.published !== true) continue;

    const refs = collectMarkdownAssetRefs(parsed.content);
    const rewrittenBody = rewritePageAssetPaths(parsed.content, slug);
    const synced = matter.stringify(rewrittenBody, publicPageData(parsed.data));

    await fsPromises.mkdir(targetPages, { recursive: true });
    await fsPromises.writeFile(path.join(targetPages, `${slug}.md`), synced);

    await processReferencedAssets(
      refs,
      sourceDir,
      path.join(targetPageAssets, slug),
      `/assets/pages/${slug}`,
    );
  }
}

async function syncWriteups() {
  const entries = await fsPromises.readdir(sourceWriteups, { withFileTypes: true });
  await emptyDir(targetWriteups);
  await emptyDir(targetWriteupAssets);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const slug = entry.name;
    const sourceDir = path.join(sourceWriteups, slug);
    const sourceIndex = path.join(sourceDir, 'index.md');
    try {
      await fsPromises.access(sourceIndex);
    } catch {
      continue;
    }

    const raw = await fsPromises.readFile(sourceIndex, 'utf8');
    const parsed = matter(raw);
    if (!includeDrafts && parsed.data.published !== true) continue;

    const content = stripRepeatedDescription(parsed.content, parsed.data.description);
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    const refs = collectMarkdownAssetRefs(content);
    const coverRef = normalizeLocalAssetRef(parsed.data.cover_image);
    if (coverRef) refs.add(coverRef);

    const rewrittenContent = rewriteWriteupAssetPaths(content, slug);
    const syncedMarkdown = matter.stringify(
      rewrittenContent,
      publicWriteupData(parsed.data, contentHash, slug),
    );

    const targetDir = path.join(targetWriteups, slug);
    await fsPromises.mkdir(targetDir, { recursive: true });
    await fsPromises.writeFile(path.join(targetDir, 'index.md'), syncedMarkdown);

    await processReferencedAssets(
      refs,
      sourceDir,
      path.join(targetWriteupAssets, slug),
      `/assets/writeups/${slug}`,
    );
  }
}

await fsPromises.mkdir(imageCacheDir, { recursive: true });
await syncPages();
await syncWriteups();

const sortedManifest = Object.fromEntries(
  Object.keys(imageManifest)
    .sort()
    .map((key) => [key, imageManifest[key]]),
);
await fsPromises.mkdir(path.dirname(targetImageManifest), { recursive: true });
await fsPromises.mkdir(path.dirname(syncManifestPath), { recursive: true });
await fsPromises.writeFile(targetImageManifest, `${JSON.stringify(sortedManifest, null, 2)}\n`);
await fsPromises.writeFile(syncManifestPath, JSON.stringify(syncManifest, null, 2));

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
