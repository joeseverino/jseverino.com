#!/usr/bin/env node
// Internal link integrity over the built HTML. The sitemap smoke test proves
// every page exists; this proves every internal reference *inside* the pages
// (href, src, srcset, poster — including same-origin absolute URLs like the
// canonical link) resolves to a file the build actually emitted. A typo'd
// in-content link fails here, before deploy, instead of surfacing in the live
// sitemap traversal after.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../../src/lib/site-config.mjs';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distDir = ['dist.nosync', 'dist']
  .map((dir) => path.join(siteRoot, dir))
  .find((dir) => fs.existsSync(dir));

if (!distDir) {
  console.error('check-links: no build output found. Run `astro build` first.');
  process.exit(1);
}

// Routes served by Cloudflare Pages functions, not by emitted files.
const DYNAMIC_ROUTE_PREFIXES = ['/api/', '/__sitedrift/', '/cdn-cgi/'];
const origin = `https://${SITE.domain}`;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith('.html')) files.push(full);
  }
  return files;
}

const pages = walk(distDir);

if (pages.length === 0) {
  console.error(`check-links: no HTML pages found in ${path.relative(siteRoot, distDir)}. Run the build first.`);
  process.exit(1);
}

// Normalize a reference to a root-relative pathname, or null when it is out
// of scope (external origin, mailto:, data:, fragment-only, …).
function internalPathname(reference, pageDir) {
  let value = reference.trim();
  if (!value || value.startsWith('#')) return null;
  if (value.startsWith(origin)) value = value.slice(origin.length) || '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return null;

  const withoutSuffix = value.split('#')[0].split('?')[0];
  if (!withoutSuffix) return null;

  const resolved = withoutSuffix.startsWith('/')
    ? withoutSuffix
    : `/${path.posix.join(pageDir, withoutSuffix)}`;
  try {
    return decodeURI(resolved);
  } catch {
    return resolved;
  }
}

function resolvesInDist(pathname) {
  if (DYNAMIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  const target = path.join(distDir, pathname);
  if (pathname.endsWith('/')) return fs.existsSync(path.join(target, 'index.html'));
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return true;
  return fs.existsSync(path.join(target, 'index.html'));
}

const failures = [];
let referenceCount = 0;
const checked = new Map();

for (const file of pages) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(distDir, file);
  const pageDir = path.posix.dirname(`/${rel.split(path.sep).join('/')}`);

  const references = [];
  for (const match of html.matchAll(/(?:href|src|poster)=["']([^"']+)["']/g)) {
    references.push(match[1]);
  }
  for (const match of html.matchAll(/srcset=["']([^"']+)["']/g)) {
    for (const candidate of match[1].split(',')) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) references.push(url);
    }
  }

  for (const reference of references) {
    const pathname = internalPathname(reference, pageDir);
    if (!pathname) continue;
    referenceCount += 1;
    if (!checked.has(pathname)) checked.set(pathname, resolvesInDist(pathname));
    if (!checked.get(pathname)) failures.push(`${rel}: ${reference}`);
  }
}

if (failures.length) {
  console.error('check-links: internal references that do not resolve in the build output:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`ok       ${pages.length} pages, ${referenceCount} internal references (${checked.size} unique) resolve`);
