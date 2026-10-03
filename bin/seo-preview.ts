#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';
import { cli } from './lib/args.ts';
import { SITE, SITE_ORIGIN as siteUrl, writeupPath } from '../src/lib/site-config.ts';
import { snapshotPageSlugs, snapshotWriteups } from '../src/lib/snapshot.ts';
import { buildOutDir } from '../src/lib/build-output.ts';
import { siteRoot } from '../src/lib/site-root.ts';

const distRoot = path.join(siteRoot, buildOutDir);
const siteHost = new URL(siteUrl).hostname;
const USAGE = `Usage: node bin/seo-preview.ts <url|path|slug>

Examples:
  node bin/seo-preview.ts ${SITE.domain}
  node bin/seo-preview.ts portfolio
  node bin/seo-preview.ts --result portfolio
  node bin/seo-preview.ts /portfolio/architecting-a-custom-detection-engine/
  node bin/seo-preview.ts architecting-a-custom-detection-engine

Options:
  -r, --result   Show only the Google-style result preview

Reads built HTML from dist. Run npm run build:static first if the page is missing.`;

function normalizePath(input: string): string {
  const raw = input.trim();
  if (!raw) return '/';

  if (/^https?:\/\//i.test(raw)) return new URL(raw).pathname || '/';
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(raw)) {
    return new URL(`https://${raw}`).pathname || '/';
  }
  if (raw.startsWith('/')) return raw.endsWith('/') || path.extname(raw) ? raw : `${raw}/`;

  if (raw === 'home') return '/';
  if (snapshotPageSlugs().includes(raw)) return `/${raw}/`;
  if (snapshotWriteups().some((writeup) => writeup.slug === raw)) return writeupPath(raw);

  return `/${raw.replace(/^\/+|\/+$/g, '')}/`;
}

function htmlPath(urlPath: string): string {
  if (urlPath === '/') return path.join(distRoot, 'index.html');
  if (urlPath.endsWith('.html')) return path.join(distRoot, urlPath);
  return path.join(distRoot, urlPath, 'index.html');
}

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (match) => ENTITY_MAP[match] ?? match);
}

function attr(html: string, selector: string, attrName = 'content'): string {
  const pattern = new RegExp(`<meta\\s+[^>]*${RegExp.escape(selector)}[^>]*>`, 'i');
  const tag = html.match(pattern)?.[0];
  if (!tag) return '';
  const value = tag.match(new RegExp(`${attrName}=["']([^"']*)["']`, 'i'))?.[1] ?? '';
  return decodeEntities(value);
}

function linkHref(html: string, rel: string): string {
  const tag = html.match(new RegExp(`<link\\s+[^>]*rel=["']${rel}["'][^>]*>`, 'i'))?.[0];
  const value = tag?.match(/href=["']([^"']*)["']/i)?.[1] ?? '';
  return decodeEntities(value);
}

function title(html: string): string {
  return decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '');
}

function textWidth(value: string): number {
  return [...value].length;
}

function truncate(value: string, max: number): string {
  const chars = [...value];
  if (chars.length <= max) return value;
  return `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

function crumb(url: string): string {
  const parsed = new URL(url);
  const parts = parsed.pathname
    .replace(/^\/|\/$/g, '')
    .split('/')
    .filter(Boolean)
    .map((part) => part.replaceAll('-', ' '));
  return parts.length ? `${parsed.hostname} › ${parts.join(' › ')}` : parsed.hostname;
}

function row(label: string, value: string): void {
  console.log(`  ${styleText('dim', label.padEnd(12))} ${value}`);
}

function check(label: string, ok: boolean, detail: string): void {
  const mark = ok ? styleText('green', 'PASS'.padEnd(8)) : styleText('yellow', 'REVIEW'.padEnd(8));
  console.log(`  ${mark} ${label.padEnd(13)} ${detail}`);
}

const { values, positionals } = cli({
  usage: USAGE,
  options: { result: { type: 'boolean', short: 'r', default: false } },
  allowPositionals: true,
});
const resultOnly = values.result;
const [input] = positionals;

if (!input) {
  console.error(USAGE);
  process.exit(1);
}

const urlPath = normalizePath(input);
const file = htmlPath(urlPath);

if (!fs.existsSync(file)) {
  console.error(`Missing built HTML for ${urlPath}`);
  console.error(`Expected: ${path.relative(siteRoot, file)}`);
  console.error('Run npm run build:static, or pass a path that exists in dist.');
  process.exit(1);
}

const html = fs.readFileSync(file, 'utf8');
const canonical = linkHref(html, 'canonical') || new URL(urlPath, siteUrl).href;
const pageTitle = title(html);
const description = attr(html, 'name="description"');
const robots = attr(html, 'name="robots"');
const ogTitle = attr(html, 'property="og:title"');
const ogDescription = attr(html, 'property="og:description"');
const ogImage = attr(html, 'property="og:image"');
const ogType = attr(html, 'property="og:type"');
const titleLength = textWidth(pageTitle);
const descriptionLength = textWidth(description);
const relativeFile = path.relative(siteRoot, file);

console.log();
function printResult() {
  console.log(styleText('bold', 'Google-style result'));
  console.log(`  ${styleText('green', crumb(canonical))}`);
  console.log(`  ${styleText('blue', truncate(pageTitle, 62))}`);
  console.log(`  ${truncate(description, 158)}`);
  console.log();
}

if (resultOnly) {
  printResult();
  process.exit(0);
}

console.log(styleText('bold', 'SEO Preview'));
console.log(styleText('dim', 'Generated from built Astro HTML'));
console.log();
row('input', input);
row('path', urlPath);
row('source', relativeFile);
console.log();

printResult();

console.log(styleText('bold', 'Metadata'));
row('canonical', canonical);
row('title', `${pageTitle} ${styleText('dim', `(${titleLength} chars)`)}`);
row('description', `${description} ${styleText('dim', `(${descriptionLength} chars)`)}`);
row('robots', robots || 'indexable');
row('og:type', ogType || styleText('yellow', 'missing'));
row('og:title', ogTitle || styleText('yellow', 'missing'));
row('og:image', ogImage || styleText('yellow', 'missing'));
console.log();

console.log(styleText('bold', 'Checks'));
check('canonical', new URL(canonical).hostname === siteHost, 'production domain');
check('title', titleLength >= 20 && titleLength <= 65, 'target 20-65 chars');
check('description', descriptionLength >= 70 && descriptionLength <= 170, 'target 70-170 chars');
check('robots', !/noindex/i.test(robots), robots || 'indexable');
check('Open Graph', Boolean(ogTitle && ogDescription && ogImage), 'title, description, image');
console.log();
