#!/usr/bin/env node
// Derive the vendored brand/design tokens from the lockfile-pinned severino-brand
// contract. Run `npm run sync:tokens`, review, commit; CI runs it with `--check`.
// Each target is rewritten between markers; the rest is hand-managed.
import path from 'node:path';
import { syncTargets, toJs, webContract } from 'severino-brand';
import { checkMode } from './lib/args.ts';
import { brandVarsCss } from '../src/lib/brand.ts';
import { siteRoot } from '../src/lib/site-root.ts';

const check = checkMode('usage: node bin/sync-tokens.ts [--check]');

const brandBlock = [
  `export const BRAND_CONTRACT = ${toJs({ schema: webContract.schema, digest: webContract.digest })};`,
  `export const BRAND = ${toJs(webContract.identity)};`,
  `export const CARD_COLORS = ${toJs(webContract.cardColors)};`,
  `export const PRIMARY_BY_THEME = ${toJs(webContract.primaryByTheme)};`,
].join('\n\n');
const surfaceBlock = `export const SURFACE = ${toJs(webContract.surfaces)};`;

const targets = [
  { file: path.join(siteRoot, 'src/styles/tokens.css'), label: '/* tokens', inner: webContract.designSystemCss },
  { file: path.join(siteRoot, 'src/lib/brand.ts'), label: '// tokens', inner: brandBlock },
  { file: path.join(siteRoot, 'src/lib/brand.ts'), label: '// surfaces', inner: surfaceBlock },
  { file: path.join(siteRoot, 'src/styles/brand.css'), label: '/* brand', inner: brandVarsCss(webContract.primaryByTheme) },
];

const changed = syncTargets(targets, { root: siteRoot, check });

console.log(
  `\n${check ? 'Verified' : 'Synced'} brand contract ${webContract.digest}.` +
    (changed ? '\nReview the diff and commit.' : ''),
);
