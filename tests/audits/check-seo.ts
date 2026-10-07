#!/usr/bin/env node

import { builtPages, finish } from './lib.ts';

const { pages } = builtPages('check-seo');

const problems: string[] = [];

for (const { rel, html } of pages) {

  // Redirect stubs (e.g. Astro.redirect) are not indexable content pages.
  if (/http-equiv=["']refresh["']/i.test(html)) continue;

  const missing: string[] = [];

  if (!/<title>[^<]*\S[^<]*<\/title>/.test(html)) missing.push('non-empty <title>');
  if (!/<link[^>]+rel=["']canonical["']/.test(html)) missing.push('canonical link');
  if (!/<meta[^>]+property=["']og:title["']/.test(html)) missing.push('og:title');
  if (!/<meta[^>]+property=["']og:image["']/.test(html)) missing.push('og:image');

  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      JSON.parse(match[1] ?? '');
    } catch {
      missing.push('invalid JSON-LD');
    }
  }

  if (missing.length) problems.push(`${rel}: missing ${missing.join(', ')}`);
}

finish(problems, `${pages.length} pages: title, canonical, og:title, og:image, valid JSON-LD`, {
  heading: 'check-seo: pages with missing or invalid SEO metadata:',
});
