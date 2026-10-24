// Byte budgets over the built output: per-page HTML, the inlined stylesheet, total JS, and each image.
// Set from the measured baseline with headroom.

import fs from 'node:fs';
import path from 'node:path';
import { builtPages, finish } from './lib.ts';

const BUDGET = {
  pageHtmlBytes: 150 * 1024,
  totalCssBytes: 75 * 1024,
  totalJsBytes: 25 * 1024,
  imageBytes: 1.5 * 1024 * 1024,
};

const { distDir, files, pages } = builtPages('check-page-weight');
const sizes = new Map(files.map((rel) => [rel, fs.statSync(path.join(distDir, rel)).size]));
const size = (rel: string): number => sizes.get(rel) ?? 0;
const sum = (list: readonly string[]): number => list.reduce((total, rel) => total + size(rel), 0);

const kb = (bytes: number): string => `${Math.ceil(bytes / 1024)}KB`;
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const failures: string[] = [];

let heaviestPage = { rel: '', size: 0 };
for (const { rel } of pages) {
  if (size(rel) > heaviestPage.size) heaviestPage = { rel, size: size(rel) };
  if (size(rel) > BUDGET.pageHtmlBytes) {
    failures.push(`${rel}: ${kb(size(rel))} HTML exceeds the ${kb(BUDGET.pageHtmlBytes)} per-page budget`);
  }
}

// Astro inlines the site stylesheet into every page, so the CSS budget is the largest <style> block.
// External .css counts too, except embed/bundle.css (an embeddable artifact no page loads).
const inlineCss = Math.max(0, ...pages.map(({ html }) => Buffer.byteLength(html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '')));
const totalCss = inlineCss + sum(files.filter((rel) => rel.endsWith('.css') && !rel.startsWith(`embed${path.sep}`)));
if (totalCss > BUDGET.totalCssBytes) {
  failures.push(`total CSS ${kb(totalCss)} exceeds the ${kb(BUDGET.totalCssBytes)} budget`);
}

const totalJs = sum(files.filter((rel) => rel.endsWith('.js')));
if (totalJs > BUDGET.totalJsBytes) {
  failures.push(`total JS ${kb(totalJs)} exceeds the ${kb(BUDGET.totalJsBytes)} budget`);
}

// Committed under public/assets/ or encoded from a content original.
const images = files.filter((rel) => /\.(?:png|jpe?g|webp|avif|gif|svg)$/i.test(rel));
for (const rel of images.filter((image) => size(image) >= BUDGET.imageBytes).toSorted((a, b) => size(b) - size(a))) {
  failures.push(`${rel}: ${mb(size(rel))} image is at or over the ${mb(BUDGET.imageBytes)} per-image budget`);
}

finish(
  failures,
  `${pages.length} pages within budget: heaviest ${heaviestPage.rel} ${kb(heaviestPage.size)}/${kb(BUDGET.pageHtmlBytes)}, CSS ${kb(totalCss)}/${kb(BUDGET.totalCssBytes)}, JS ${kb(totalJs)}/${kb(BUDGET.totalJsBytes)}, ${images.length} images (${mb(sum(images))}) each under ${mb(BUDGET.imageBytes)}`,
  {
    heading: 'check-page-weight: byte budget exceeded:',
    fix: 'fix: reduce the page, bundle, or image (the committed file under public/assets/, or the content original it was encoded from), or raise BUDGET here in its own commit',
  },
);
