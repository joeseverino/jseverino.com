#!/usr/bin/env node
// Structural HTML assertions over every built page — the static, all-pages
// complement to the axe accessibility sweep (which runs deeper rules but only
// on key pages in the browser suite). Two invariants, checked in bytes:
//
//   • no duplicate id attributes on a page (breaks fragment links, label
//     association, and aria-* references silently)
//   • every <img> carries an alt attribute (empty alt is valid — it marks a
//     decorative image — but a missing attribute is always an authoring bug)

import fs from 'node:fs';
import path from 'node:path';
import { builtHtmlPages } from './lib.mjs';

const { distDir, pages } = builtHtmlPages('check-html');

const problems = [];
let idCount = 0;
let imgCount = 0;

for (const file of pages) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(distDir, file);

  const seen = new Map();
  for (const match of html.matchAll(/<[a-zA-Z][^>]*\sid="([^"]*)"/g)) {
    idCount += 1;
    seen.set(match[1], (seen.get(match[1]) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count > 1) problems.push(`${rel}: id "${id}" appears ${count} times`);
  }

  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    imgCount += 1;
    if (!/\salt=/.test(match[0])) {
      problems.push(`${rel}: <img> without an alt attribute (${match[0].slice(0, 80)}…)`);
    }
  }
}

if (problems.length > 0) {
  console.error('check-html: structural problems in the built HTML:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`ok       ${pages.length} pages: ${idCount} ids unique per page, ${imgCount} images all carry alt`);
