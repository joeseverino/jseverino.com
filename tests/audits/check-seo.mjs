#!/usr/bin/env node
// Static SEO assertions over the built HTML. Every rendered page must carry the
// head tags that search engines and link unfurlers depend on. Runs after the
// build against the local outDir (dist.nosync) or the CI outDir (dist).

import fs from 'node:fs';
import path from 'node:path';
import { builtHtmlPages } from './lib.mjs';

const { distDir, pages } = builtHtmlPages('check-seo');

const problems = [];

for (const file of pages) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(distDir, file);

  // Redirect stubs (e.g. Astro.redirect) are not indexable content pages.
  if (/http-equiv=["']refresh["']/i.test(html)) continue;

  const missing = [];

  if (!/<title>[^<]*\S[^<]*<\/title>/.test(html)) missing.push('non-empty <title>');
  if (!/<link[^>]+rel=["']canonical["']/.test(html)) missing.push('canonical link');
  if (!/<meta[^>]+property=["']og:title["']/.test(html)) missing.push('og:title');
  if (!/<meta[^>]+property=["']og:image["']/.test(html)) missing.push('og:image');

  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      JSON.parse(match[1]);
    } catch {
      missing.push('invalid JSON-LD');
    }
  }

  if (missing.length) problems.push(`${rel}: missing ${missing.join(', ')}`);
}

if (problems.length) {
  console.error('check-seo: pages with missing or invalid SEO metadata:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`ok       ${pages.length} pages: title, canonical, og:title, og:image, valid JSON-LD`);
