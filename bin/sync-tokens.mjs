#!/usr/bin/env node
// Derive the site's vendored brand/design tokens from the upstream brand kit.
//
// Upstream source of truth: severino-brand/brand/tokens.json
//   - `brand`        → src/lib/brand.mjs   (the BRAND export)
//   - `designSystem` → src/styles/base.css (the :root token block)
//
// Run on demand (`npm run sync:tokens`), review the diff, commit. This is the
// only thing that touches severino-brand — the build never does, so CI stays
// self-sufficient. Mirrors the sync-content.mjs model (external SOT → committed
// artifact). Each target is rewritten between `tokens:start`/`tokens:end`
// markers; everything outside them is hand-managed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brandRoot = process.env.BRAND_DIR
  ? path.resolve(process.env.BRAND_DIR)
  : path.resolve(siteRoot, '../../Assets/severino-brand');

const tokensPath = path.join(brandRoot, 'brand/tokens.json');
const basePath = path.join(siteRoot, 'src/styles/base.css');
const brandPath = path.join(siteRoot, 'src/lib/brand.mjs');

if (!fs.existsSync(tokensPath)) {
  console.error(`No brand tokens at ${tokensPath}.`);
  console.error('Set BRAND_DIR to the severino-brand checkout, or clone it beside the site.');
  process.exit(1);
}

const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));

/** Replace the text between `${label}:start` and `${label}:end` markers, in place. */
function spliceMarkers(source, label, inner, file) {
  const start = source.indexOf(`${label}:start`);
  const end = source.indexOf(`${label}:end`);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Missing ${label}:start/${label}:end markers in ${path.relative(siteRoot, file)}`);
  }
  const afterStartLine = source.indexOf('\n', start) + 1;
  const endLineStart = source.lastIndexOf('\n', end) + 1;
  return source.slice(0, afterStartLine) + inner + '\n' + source.slice(endLineStart);
}

/** Serialize a value as a JS object literal: unquoted identifier keys, single quotes. */
function toJs(value, depth = 0) {
  if (value === null || typeof value !== 'object') return `'${value}'`;
  const pad = '  '.repeat(depth + 1);
  const close = '  '.repeat(depth);
  const body = Object.entries(value)
    .map(([key, val]) => {
      const safeKey = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`;
      return `${pad}${safeKey}: ${toJs(val, depth + 1)},`;
    })
    .join('\n');
  return `{\n${body}\n${close}}`;
}

// designSystem → :root block.
const rootBody = Object.entries(tokens.designSystem)
  .map(([property, value]) => `  ${property}: ${value};`)
  .join('\n');
const rootBlock = `:root {\n${rootBody}\n}`;

// brand → BRAND export.
const brandBlock = `export const BRAND = ${toJs(tokens.brand)};`;

const targets = [
  { file: basePath, label: '/* tokens', inner: rootBlock },
  { file: brandPath, label: '// tokens', inner: brandBlock },
];

let changed = 0;
for (const { file, label, inner } of targets) {
  const before = fs.readFileSync(file, 'utf8');
  const after = spliceMarkers(before, label, inner, file);
  const rel = path.relative(siteRoot, file);
  if (after === before) {
    console.log(`= ${rel} (already in sync)`);
    continue;
  }
  fs.writeFileSync(file, after);
  console.log(`✓ ${rel} (rewrote token block)`);
  changed += 1;
}

const count = Object.keys(tokens.designSystem).length;
console.log(
  `\nSynced ${count} design tokens + brand identity from ${path.relative(siteRoot, tokensPath)}.` +
    (changed ? '\nReview the diff and commit.' : ''),
);
