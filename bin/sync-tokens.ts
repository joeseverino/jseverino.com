#!/usr/bin/env node
// Derive the vendored brand/design tokens from the lockfile-pinned severino-brand
// contract. Run `mise run sync:tokens`, review, commit; CI runs it with `--check`.
// Each target is rewritten between markers; the rest is hand-managed.
import path from 'node:path';
import { syncTargets, toJs, webContract } from 'severino-brand';
import { checkMode } from './lib/args.ts';
import { regenerateCommand } from './lib/projection.ts';
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

// A generated CSS block is where the literal colors live, so it switches off exactly the
// stylelint color rules its values trip, and only between its own markers.
const literalColors = (css: string, rules: readonly string[]): string =>
  `/* stylelint-disable ${rules.join(', ')} -- generated literal colors */\n${css}\n/* stylelint-enable ${rules.join(', ')} */`;

const targets = [
  {
    file: path.join(siteRoot, 'src/styles/tokens.css'),
    label: '/* tokens',
    inner: literalColors(webContract.designSystemCss, ['color-no-hex', 'function-disallowed-list']),
  },
  { file: path.join(siteRoot, 'src/lib/brand.ts'), label: '// tokens', inner: brandBlock },
  { file: path.join(siteRoot, 'src/lib/brand.ts'), label: '// surfaces', inner: surfaceBlock },
  {
    file: path.join(siteRoot, 'src/styles/brand.css'),
    label: '/* brand',
    inner: literalColors(brandVarsCss(webContract.primaryByTheme), ['color-no-hex']),
  },
];

if (check) {
  // A check prints only what is stale; syncTargets logs each stale target, then throws.
  const stale: string[] = [];
  try {
    const log = (line: string): void => {
      if (!line.startsWith('=')) stale.push(line);
    };
    syncTargets(targets, { root: siteRoot, check, log });
  } catch (error) {
    if (stale.length === 0) throw error;
    console.error(`${stale.join('\n')}\nrun: ${regenerateCommand()}`);
    process.exit(1);
  }
  console.log(`ok       brand tokens derive from severino-brand contract ${webContract.digest.slice(7, 19)}`);
} else {
  const changed = syncTargets(targets, { root: siteRoot });
  console.log(`\nSynced brand contract ${webContract.digest}.${changed ? '\nReview the diff and commit.' : ''}`);
}
