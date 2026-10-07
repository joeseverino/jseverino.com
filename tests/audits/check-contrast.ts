#!/usr/bin/env node
// WCAG 2.1 contrast for every color-on-background pair the site CSS renders, against AA.
// Tokens are `light-dark()` pairs, so each pair is measured once per theme.

import path from 'node:path';
import { BRAND } from '../../src/lib/brand.ts';
import { readCssEntry } from '../../bin/lib/css-entry.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { abort } from './lib.ts';

const cssPath = path.join(siteRoot, 'src/styles/base.css');
const AA_NORMAL = 4.5;

const fail: (message: string) => never = (message) => abort('check-contrast', message);

function srgbChannelToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const short = hex.replace('#', '');
  const value = short.length === 3 ? [...short].map((digit) => digit + digit).join('') : short;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

const css = readCssEntry(cssPath);

// Scoped to the generated token block, the only place --color-* is declared, so a later override
// elsewhere cannot shadow the measured value.
const blockStart = css.indexOf('tokens:start');
const blockEnd = css.indexOf('tokens:end');
if (blockStart === -1 || blockEnd === -1) fail(`no tokens:start/tokens:end block in ${cssPath}`);
const tokenBlock = css.slice(blockStart, blockEnd);

const HEX = '#[0-9a-fA-F]{3,6}';
const LIGHT_DARK = new RegExp(`^light-dark\\(\\s*(${HEX})\\s*,\\s*(${HEX})\\s*\\)$`);
const PLAIN = new RegExp(`^${HEX}$`);

// Collect --color-* as { light, dark }. Non-opaque values (color-mix, rgb with alpha) are skipped;
// a pair naming one fails loudly below.
const tokens = new Map<string, { light: string; dark: string }>();
for (const [, name, raw = ''] of tokenBlock.matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
  const value = raw.trim();
  const dual = value.match(LIGHT_DARK);
  if (dual?.[1] && dual[2]) tokens.set(`--color-${name}`, { light: dual[1].toLowerCase(), dark: dual[2].toLowerCase() });
  else if (PLAIN.test(value)) tokens.set(`--color-${name}`, { light: value.toLowerCase(), dark: value.toLowerCase() });
}

// --color-primary lives in brand.ts, outside the design tokens, so fold it in from the source
// src/styles/brand.css is generated from.
tokens.set('--color-primary', {
  light: BRAND.navy.toLowerCase(),
  dark: BRAND.onDark.primary.toLowerCase(),
});
tokens.set('--color-primary-deep', {
  light: BRAND.navyDeep.toLowerCase(),
  dark: BRAND.onDark.primaryDeep.toLowerCase(),
});
if (tokens.size === 0) fail(`no --color-* tokens found in ${cssPath}`);

// Pairs the site renders; add one when a component introduces a new combination.
const pairs = [
  { name: 'body text on background', fg: '--color-text', bg: '--color-bg' },
  { name: 'muted text on background', fg: '--color-muted', bg: '--color-bg' },
  { name: 'text-alt on background', fg: '--color-text-alt', bg: '--color-bg' },
  { name: 'primary on background', fg: '--color-primary', bg: '--color-bg' },
  { name: 'body text on raised surface', fg: '--color-text', bg: '--color-surface' },
  { name: 'muted text on raised surface', fg: '--color-muted', bg: '--color-surface' },
  { name: 'body text on soft surface', fg: '--color-text', bg: '--color-soft' },
  { name: 'muted text on soft surface', fg: '--color-muted', bg: '--color-soft' },
  { name: 'primary on soft surface', fg: '--color-primary', bg: '--color-soft' },
  { name: 'button label on primary', fg: '--color-bg', bg: '--color-primary' },
  { name: 'inline code on code chip', fg: '--color-code-text', bg: '--color-code-bg' },
];

let failed = false;
const lines: string[] = [];
for (const theme of ['light', 'dark'] as const) {
  for (const pair of pairs) {
    const fg = tokens.get(pair.fg)?.[theme];
    const bg = tokens.get(pair.bg)?.[theme];
    if (!fg || !bg) {
      console.error(`check-contrast: ${!fg ? pair.fg : pair.bg} has no measurable ${theme} value`);
      failed = true;
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    const ok = ratio >= AA_NORMAL;
    if (!ok) failed = true;
    lines.push(
      `${ok ? 'ok  ' : 'FAIL'}  ${theme.padEnd(5)} ${ratio.toFixed(2).padStart(5)}:1  ${pair.name} (${fg} on ${bg})`,
    );
  }
}

console.log(lines.join('\n'));
if (failed) {
  console.error('check-contrast: at least one pair fails WCAG AA (4.5:1).');
  process.exit(1);
}
console.log(`ok       ${pairs.length} pairs x 2 themes measured, all >= ${AA_NORMAL}:1`);
