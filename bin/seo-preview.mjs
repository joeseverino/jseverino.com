#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(siteRoot, 'dist.nosync');
const siteUrl = 'https://jseverino.com';
const siteHost = new URL(siteUrl).hostname;

function usage() {
  console.log(`Usage: node bin/seo-preview.mjs <url|path|slug>

Examples:
  node bin/seo-preview.mjs jseverino.com
  node bin/seo-preview.mjs portfolio
  node bin/seo-preview.mjs /portfolio/architecting-a-custom-detection-engine/
  node bin/seo-preview.mjs architecting-a-custom-detection-engine

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

function decodeEntities(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'");
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

function verdict(label, ok, detail) {
  const mark = ok ? 'OK' : 'CHECK';
  console.log(`${mark.padEnd(5)} ${label.padEnd(14)} ${detail}`);
}

const input = process.argv[2];
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

console.log();
console.log('Google result preview');
console.log('─────────────────────');
console.log(crumb(canonical));
console.log(truncate(pageTitle, 62));
console.log(truncate(description, 158));
console.log();
console.log('Metadata');
console.log('────────');
console.log(`Path:        ${urlPath}`);
console.log(`Canonical:   ${canonical}`);
console.log(`Title:       ${pageTitle} (${textWidth(pageTitle)} chars)`);
console.log(`Description: ${description} (${textWidth(description)} chars)`);
console.log(`Robots:      ${robots || 'indexable'}`);
console.log(`OG type:     ${ogType || 'missing'}`);
console.log(`OG title:    ${ogTitle || 'missing'}`);
console.log(`OG image:    ${ogImage || 'missing'}`);
console.log();
console.log('Checks');
console.log('──────');
verdict('canonical', new URL(canonical).hostname === siteHost, 'uses production domain');
verdict('title', textWidth(pageTitle) >= 20 && textWidth(pageTitle) <= 65, 'target 20-65 chars');
verdict('description', textWidth(description) >= 70 && textWidth(description) <= 170, 'target 70-170 chars');
verdict('robots', !/noindex/i.test(robots), robots || 'indexable');
verdict('Open Graph', Boolean(ogTitle && ogDescription && ogImage), 'title, description, image present');
console.log();
