#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../src/lib/site-config.mjs';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(siteRoot, 'dist.nosync');
const siteUrl = `https://${SITE.domain}`;
const siteHost = new URL(siteUrl).hostname;
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const color = {
  dim: (value) => useColor ? `\u001b[2m${value}\u001b[0m` : value,
  green: (value) => useColor ? `\u001b[32m${value}\u001b[0m` : value,
  yellow: (value) => useColor ? `\u001b[33m${value}\u001b[0m` : value,
  blue: (value) => useColor ? `\u001b[34m${value}\u001b[0m` : value,
  bold: (value) => useColor ? `\u001b[1m${value}\u001b[0m` : value,
};

function usage() {
  console.log(`Usage: node bin/seo-preview.mjs <url|path|slug>

Examples:
  node bin/seo-preview.mjs ${SITE.domain}
  node bin/seo-preview.mjs portfolio
  node bin/seo-preview.mjs --result portfolio
  node bin/seo-preview.mjs /portfolio/architecting-a-custom-detection-engine/
  node bin/seo-preview.mjs architecting-a-custom-detection-engine

Options:
  -r, --result   Show only the Google-style result preview

Reads built HTML from dist.nosync. Run npm run build:static first if the page is missing.`);
}

function pageSlugs() {
  const dir = path.join(siteRoot, 'src/content/pages');
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs.readdirSync(dir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.replace(/\.md$/, '')),
  );
}

function writeupSlugs() {
  const dir = path.join(siteRoot, 'src/content/writeups');
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
}

function normalizePath(input) {
  const raw = input.trim();
  if (!raw) return '/';

  if (/^https?:\/\//i.test(raw)) return new URL(raw).pathname || '/';
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(raw)) {
    return new URL(`https://${raw}`).pathname || '/';
  }
  if (raw.startsWith('/')) return raw.endsWith('/') || path.extname(raw) ? raw : `${raw}/`;

  const pages = pageSlugs();
  if (raw === 'home') return '/';
  if (pages.has(raw)) return raw === 'home' ? '/' : `/${raw}/`;
  if (writeupSlugs().has(raw)) return `/portfolio/${raw}/`;

  return `/${raw.replace(/^\/+|\/+$/g, '')}/`;
}

function htmlPath(urlPath) {
  if (urlPath === '/') return path.join(distRoot, 'index.html');
  if (urlPath.endsWith('.html')) return path.join(distRoot, urlPath);
  return path.join(distRoot, urlPath, 'index.html');
}

const ENTITY_MAP = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
};

function decodeEntities(value) {
  return value.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (match) => ENTITY_MAP[match]);
}

function attr(html, selector, attrName = 'content') {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<meta\\s+[^>]*${escaped}[^>]*>`, 'i');
  const tag = html.match(pattern)?.[0];
  if (!tag) return '';
  const value = tag.match(new RegExp(`${attrName}=["']([^"']*)["']`, 'i'))?.[1] ?? '';
  return decodeEntities(value);
}

function linkHref(html, rel) {
  const tag = html.match(new RegExp(`<link\\s+[^>]*rel=["']${rel}["'][^>]*>`, 'i'))?.[0];
  const value = tag?.match(/href=["']([^"']*)["']/i)?.[1] ?? '';
  return decodeEntities(value);
}

function title(html) {
  return decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '');
}

function textWidth(value) {
  return [...value].length;
}

function truncate(value, max) {
  const chars = [...value];
  if (chars.length <= max) return value;
  return `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

function crumb(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname
    .replace(/^\/|\/$/g, '')
    .split('/')
    .filter(Boolean)
    .map((part) => part.replaceAll('-', ' '));
  return parts.length ? `${parsed.hostname} › ${parts.join(' › ')}` : parsed.hostname;
}

function row(label, value) {
  console.log(`  ${color.dim(label.padEnd(12))} ${value}`);
}

function check(label, ok, detail) {
  const mark = ok ? color.green('PASS') : color.yellow('REVIEW');
  console.log(`  ${mark.padEnd(useColor ? 15 : 8)} ${label.padEnd(13)} ${detail}`);
}

const args = process.argv.slice(2);
const resultOnly = args.includes('-r') || args.includes('--result');
const input = args.find((arg) => !arg.startsWith('-'));

if (!input || input === '-h' || input === '--help') {
  usage();
  process.exit(input ? 0 : 1);
}

const urlPath = normalizePath(input);
const file = htmlPath(urlPath);

if (!fs.existsSync(file)) {
  console.error(`Missing built HTML for ${urlPath}`);
  console.error(`Expected: ${path.relative(siteRoot, file)}`);
  console.error('Run npm run build:static, or pass a path that exists in dist.nosync.');
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
  console.log(color.bold('Google-style result'));
  console.log(`  ${color.green(crumb(canonical))}`);
  console.log(`  ${color.blue(truncate(pageTitle, 62))}`);
  console.log(`  ${truncate(description, 158)}`);
  console.log();
}

if (resultOnly) {
  printResult();
  process.exit(0);
}

console.log(color.bold('SEO Preview'));
console.log(color.dim('Generated from built Astro HTML'));
console.log();
row('input', input);
row('path', urlPath);
row('source', relativeFile);
console.log();

printResult();

console.log(color.bold('Metadata'));
row('canonical', canonical);
row('title', `${pageTitle} ${color.dim(`(${titleLength} chars)`)}`);
row('description', `${description} ${color.dim(`(${descriptionLength} chars)`)}`);
row('robots', robots || 'indexable');
row('og:type', ogType || color.yellow('missing'));
row('og:title', ogTitle || color.yellow('missing'));
row('og:image', ogImage || color.yellow('missing'));
console.log();

console.log(color.bold('Checks'));
check('canonical', new URL(canonical).hostname === siteHost, 'production domain');
check('title', titleLength >= 20 && titleLength <= 65, 'target 20-65 chars');
check('description', descriptionLength >= 70 && descriptionLength <= 170, 'target 70-170 chars');
check('robots', !/noindex/i.test(robots), robots || 'indexable');
check('Open Graph', Boolean(ogTitle && ogDescription && ogImage), 'title, description, image');
console.log();
