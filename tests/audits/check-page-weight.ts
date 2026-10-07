#!/usr/bin/env node
// Byte budgets over the built output: per-page HTML, the inlined stylesheet, total JS.
// Set from the measured baseline with headroom.

import fs from 'node:fs';
import { walkFiles } from '../../src/lib/walk.ts';
import { builtPages, finish } from './lib.ts';

const BUDGET = {
  pageHtmlBytes: 150 * 1024,
  totalCssBytes: 75 * 1024,
  totalJsBytes: 25 * 1024,
};

const { distDir, pages: htmlFiles } = builtPages('check-page-weight');
const files = walkFiles(distDir);

const kb = (bytes: number): string => `${Math.ceil(bytes / 1024)}KB`;
const sum = (list: readonly string[]): number => list.reduce((total, file) => total + fs.statSync(file).size, 0);

const failures: string[] = [];

let heaviestPage = { rel: '', size: 0 };
for (const { file, rel } of htmlFiles) {
  const size = fs.statSync(file).size;
  if (size > heaviestPage.size) heaviestPage = { rel, size };
  if (size > BUDGET.pageHtmlBytes) {
    failures.push(`${rel}: ${kb(size)} HTML exceeds the ${kb(BUDGET.pageHtmlBytes)} per-page budget`);
  }
}

// Astro inlines the site stylesheet into every page, so the CSS budget is the largest <style> block.
// External .css counts too, except public/embed/bundle.css (an embeddable artifact no page loads).
const inlineCss = Math.max(
  0,
  ...htmlFiles.map(({ html }) => (html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '').length),
);
const totalCss = inlineCss + sum(files.filter((file) => file.endsWith('.css') && !file.includes('/embed/')));
if (totalCss > BUDGET.totalCssBytes) {
  failures.push(`total CSS ${kb(totalCss)} exceeds the ${kb(BUDGET.totalCssBytes)} budget`);
}

const totalJs = sum(files.filter((file) => file.endsWith('.js')));
if (totalJs > BUDGET.totalJsBytes) {
  failures.push(`total JS ${kb(totalJs)} exceeds the ${kb(BUDGET.totalJsBytes)} budget`);
}

finish(
  failures,
  `${htmlFiles.length} pages within budget: heaviest ${heaviestPage.rel} ${kb(heaviestPage.size)}/${kb(BUDGET.pageHtmlBytes)}, CSS ${kb(totalCss)}/${kb(BUDGET.totalCssBytes)}, JS ${kb(totalJs)}/${kb(BUDGET.totalJsBytes)}`,
  { heading: 'check-page-weight: performance budget exceeded:' },
);
