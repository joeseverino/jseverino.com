#!/usr/bin/env node
// Deterministic performance budget over the built output — the local, flake-free
// complement to the CI Lighthouse run. Three budgets, checked in bytes on disk:
// per-page HTML, total shipped CSS, and total shipped JS. The numbers are set
// from the measured baseline (~80 KB worst page, ~25 KB CSS, ~2.5 KB JS) with
// generous headroom, so a failure means a real regression — a runaway page, a
// style explosion, or a framework bundle sneaking into a no-framework site.
// Raising a budget is allowed, but it should be a conscious commit, not drift.

import fs from 'node:fs';
import path from 'node:path';
import { builtHtmlPages, walkFiles } from './lib.mjs';

const BUDGET = {
  pageHtmlBytes: 150 * 1024,
  totalCssBytes: 75 * 1024,
  totalJsBytes: 25 * 1024,
};

const { distDir, pages: htmlFiles } = builtHtmlPages('check-page-weight');
const files = walkFiles(distDir);

const kb = (bytes) => `${Math.ceil(bytes / 1024)}KB`;
const sum = (list) => list.reduce((total, file) => total + fs.statSync(file).size, 0);

const failures = [];

let heaviestPage = { rel: '', size: 0 };
for (const file of htmlFiles) {
  const size = fs.statSync(file).size;
  const rel = path.relative(distDir, file);
  if (size > heaviestPage.size) heaviestPage = { rel, size };
  if (size > BUDGET.pageHtmlBytes) {
    failures.push(`${rel}: ${kb(size)} HTML exceeds the ${kb(BUDGET.pageHtmlBytes)} per-page budget`);
  }
}

const totalCss = sum(files.filter((file) => file.endsWith('.css')));
if (totalCss > BUDGET.totalCssBytes) {
  failures.push(`total CSS ${kb(totalCss)} exceeds the ${kb(BUDGET.totalCssBytes)} budget`);
}

const totalJs = sum(files.filter((file) => file.endsWith('.js')));
if (totalJs > BUDGET.totalJsBytes) {
  failures.push(`total JS ${kb(totalJs)} exceeds the ${kb(BUDGET.totalJsBytes)} budget`);
}

if (failures.length) {
  console.error('check-page-weight: performance budget exceeded:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(
  `ok       ${htmlFiles.length} pages within budget: heaviest ${heaviestPage.rel} ${kb(heaviestPage.size)}/${kb(BUDGET.pageHtmlBytes)}, CSS ${kb(totalCss)}/${kb(BUDGET.totalCssBytes)}, JS ${kb(totalJs)}/${kb(BUDGET.totalJsBytes)}`,
);
