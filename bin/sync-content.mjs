#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vaultRoot = process.env.VAULT_DIR
  ? path.resolve(process.env.VAULT_DIR)
  : path.resolve(siteRoot, '../../Severino Labs');

const sourcePages = path.join(vaultRoot, '06 Pages');
const sourceWriteups = path.join(vaultRoot, '05 Writeups');
const targetPages = path.join(siteRoot, 'src/content/pages');
const targetSite = path.join(siteRoot, 'src/content/site.md');
const targetTechnologyGroups = path.join(siteRoot, 'src/content/technology-groups.md');
const targetWriteups = path.join(siteRoot, 'src/content/writeups');
const targetWriteupAssets = path.join(siteRoot, 'public/assets/writeups');
const targetPageAssets = path.join(siteRoot, 'public/assets/pages');

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

function copyReferencedAssets(refs, sourceDir, targetDir) {
  const copied = [];
  for (const ref of refs) {
    const source = path.resolve(sourceDir, ref);
    const target = path.resolve(targetDir, ref);

    if (!source.startsWith(sourceDir + path.sep)) {
      throw new Error(`Refusing to copy asset outside source directory: ${ref}`);
    }
    if (!fs.existsSync(source)) {
      throw new Error(`Missing referenced asset: ${source}`);
    }

    copyFile(source, target);
    copied.push(ref);
  }
  return copied;
}

function publicWriteupData(data) {
  return {
    title: data.title,
    excerpt: data.excerpt,
    published: true,
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
    published: true,
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

function normalizeExcerpt(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\$/gm, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripRepeatedExcerpt(markdown, excerpt) {
  if (typeof excerpt !== 'string' || !excerpt.trim()) return markdown;

  const expected = normalizeExcerpt(excerpt);
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

    const text = normalizeExcerpt(candidate.join(' ').replace(/^>\s?/gm, ''));
    if (text === expected) {
      while (index < lines.length && lines[index].trim() === '') index += 1;
      continue;
    }

    output.push(...lines.slice(start, index));
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function syncPages() {
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
    if (parsed.data.published !== true) continue;

    const refs = collectMarkdownAssetRefs(parsed.content);
    const rewrittenBody = rewritePageAssetPaths(parsed.content, slug);
    const synced = matter.stringify(rewrittenBody, publicPageData(parsed.data));

    fs.mkdirSync(targetPages, { recursive: true });
    fs.writeFileSync(path.join(targetPages, `${slug}.md`), synced);

    copyReferencedAssets(refs, sourceDir, path.join(targetPageAssets, slug));
  }
}

function syncWriteups() {
  emptyDir(targetWriteups);
  emptyDir(targetWriteupAssets);

  for (const entry of fs.readdirSync(sourceWriteups, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const slug = entry.name;
    const sourceDir = path.join(sourceWriteups, slug);
    const sourceIndex = path.join(sourceDir, 'index.md');
    if (!fs.existsSync(sourceIndex)) continue;

    const parsed = matter(fs.readFileSync(sourceIndex, 'utf8'));
    if (parsed.data.published !== true) continue;

    const content = stripRepeatedExcerpt(parsed.content, parsed.data.excerpt);
    const refs = collectMarkdownAssetRefs(content);
    const coverRef = normalizeLocalAssetRef(parsed.data.cover_image);
    if (coverRef) refs.add(coverRef);

    const rewrittenContent = rewriteWriteupAssetPaths(content, slug);
    const syncedMarkdown = matter.stringify(rewrittenContent, publicWriteupData(parsed.data));

    const targetDir = path.join(targetWriteups, slug);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'index.md'), syncedMarkdown);

    copyReferencedAssets(refs, sourceDir, path.join(targetWriteupAssets, slug));
  }
}

syncPages();
syncWriteups();

console.log(`Synced pages from ${sourcePages}`);
console.log(`Synced public writeups from ${sourceWriteups}`);
