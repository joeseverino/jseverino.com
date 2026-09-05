#!/usr/bin/env node
// Derive the site's vendored brand/design tokens from the upstream brand kit.
//
// Upstream source of truth: the lockfile-pinned severino-brand contract.
// The package derives semantic roles + CSS once from brand/tokens.json; this
// consumer only serializes those normalized values into self-contained inputs.
//
// Run on demand (`npm run sync:tokens`), review the diff, commit. CI executes
// the same projection with `--check`; deployment consumes only the committed
// results. Each target is rewritten between markers; everything outside them
// is hand-managed.
//
import path from 'node:path';
import { syncTargets, toJs, webContract } from 'severino-brand';
import { brandVarsCss } from '../src/lib/brand.mjs';
import { siteRoot } from '../src/lib/site-root.mjs';

const check = process.argv.includes('--check');

const brandBlock = [
  `export const BRAND_CONTRACT = ${toJs({ schema: webContract.schema, digest: webContract.digest })};`,
  `export const BRAND = ${toJs(webContract.identity)};`,
  `export const CARD_COLORS = ${toJs(webContract.cardColors)};`,
  `export const PRIMARY_BY_THEME = ${toJs(webContract.primaryByTheme)};`,
].join('\n\n');
const surfaceBlock = `export const SURFACE = ${toJs(webContract.surfaces)};`;

const targets = [
  { file: path.join(siteRoot, 'src/styles/tokens.css'), label: '/* tokens', inner: webContract.designSystemCss },
  { file: path.join(siteRoot, 'src/lib/brand.mjs'), label: '// tokens', inner: brandBlock },
  { file: path.join(siteRoot, 'src/lib/brand.mjs'), label: '// surfaces', inner: surfaceBlock },
  { file: path.join(siteRoot, 'src/styles/brand.css'), label: '/* brand', inner: brandVarsCss(webContract.primaryByTheme) },
];

const changed = syncTargets(targets, { root: siteRoot, check });

console.log(
  `\n${check ? 'Verified' : 'Synced'} brand contract ${webContract.digest}.` +
    (changed ? '\nReview the diff and commit.' : ''),
);
