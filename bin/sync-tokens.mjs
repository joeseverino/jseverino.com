#!/usr/bin/env node
// Derive the site's vendored brand/design tokens from the upstream brand kit.
//
// Upstream source of truth: severino-brand/brand/tokens.json
//   - `brand`        → src/lib/brand.mjs   (the BRAND export)
//   - `designSystem` → src/styles/base.css (the :root token block)
//
// Run on demand (`npm run sync:tokens`), review the diff, commit. This is the
// only thing that touches severino-brand — the build never does, so CI stays
// self-sufficient. Each target is rewritten between `tokens:start`/`tokens:end`
// markers; everything outside them is hand-managed.
//
// The read/splice/render primitives live upstream in severino-brand/brand/
// sync.mjs and are SHARED with the vault's Obsidian theme generator — this
// script only declares the site's targets. Don't re-inline that logic here.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brandRoot = process.env.BRAND_DIR
  ? path.resolve(process.env.BRAND_DIR)
  : path.resolve(siteRoot, '../../Assets/severino-brand');

const { loadTokens, renderDesignSystemRoot, toJs, syncTargets } = await import(
  pathToFileURL(path.join(brandRoot, 'brand/sync.mjs')).href
);

const { tokens, tokensPath } = loadTokens(brandRoot);

// designSystem → :root block; brand → BRAND export.
const rootBlock = renderDesignSystemRoot(tokens.designSystem);
const brandBlock = `export const BRAND = ${toJs(tokens.brand)};`;

const targets = [
  { file: path.join(siteRoot, 'src/styles/base.css'), label: '/* tokens', inner: rootBlock },
  { file: path.join(siteRoot, 'src/lib/brand.mjs'), label: '// tokens', inner: brandBlock },
];

const changed = syncTargets(targets, { root: siteRoot });

const count = Object.keys(tokens.designSystem).length;
console.log(
  `\nSynced ${count} design tokens + brand identity from ${path.relative(siteRoot, tokensPath)}.` +
    (changed ? '\nReview the diff and commit.' : ''),
);
