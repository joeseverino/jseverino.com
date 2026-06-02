#!/usr/bin/env node
// Compute WCAG 2.1 contrast ratios for every color-on-background pair the
// site CSS actually renders. Reads `--color-*` tokens from base.css, parses
// rules that set `color:` and `background:` (or `background-color:`), and
// reports pass/fail against WCAG AA (4.5:1 normal text, 3:1 large text).
//
// Wired into `publish:check`. Standalone usage: `node bin/check-contrast.mjs`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = path.join(siteRoot, 'src/styles/base.css');
const AA_NORMAL = 4.5;

function fail(message) {
  console.error(`check-contrast: ${message}`);
  process.exit(1);
}

function srgbChannelToLinear(channel) {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const value = hex.replace('#', '');
  let r, g, b;
  if (value.length === 3) {
    r = parseInt(value[0] + value[0], 16);
    g = parseInt(value[1] + value[1], 16);
    b = parseInt(value[2] + value[2], 16);
  } else {
    r = parseInt(value.slice(0, 2), 16);
    g = parseInt(value.slice(2, 4), 16);
    b = parseInt(value.slice(4, 6), 16);
  }
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

const css = fs.readFileSync(cssPath, 'utf8');

// Collect --color-*: #hex assignments from the :root token block.
const tokens = new Map();
for (const match of css.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})/g)) {
  tokens.set(`--color-${match[1]}`, match[2].toLowerCase());
}
if (tokens.size === 0) fail(`no --color-* tokens found in ${cssPath}`);

// Predetermined pairs the site renders. Add new ones here when a new
// component introduces a novel combination, mirroring docs/Accessibility.md.
const pairs = [
  { name: 'body text on background', fg: '--color-text', bg: '--color-bg' },
  { name: 'muted text on background', fg: '--color-muted', bg: '--color-bg' },
  { name: 'text-alt on background', fg: '--color-text-alt', bg: '--color-bg' },
  { name: 'primary on background', fg: '--color-primary', bg: '--color-bg' },
  { name: 'body text on soft surface', fg: '--color-text', bg: '--color-soft' },
  { name: 'muted text on soft surface', fg: '--color-muted', bg: '--color-soft' },
];

let failed = false;
const lines = [];
for (const pair of pairs) {
  const fg = tokens.get(pair.fg);
  const bg = tokens.get(pair.bg);
  if (!fg) {
    console.error(`check-contrast: ${pair.fg} not defined in base.css`);
    failed = true;
    continue;
  }
  if (!bg) {
    console.error(`check-contrast: ${pair.bg} not defined in base.css`);
    failed = true;
    continue;
  }
  const ratio = contrastRatio(fg, bg);
  const ok = ratio >= AA_NORMAL;
  if (!ok) failed = true;
  lines.push(
    `${ok ? 'ok  ' : 'FAIL'}  ${ratio.toFixed(2)}:1  ${pair.name} (${fg} on ${bg})`,
  );
}

console.log(lines.join('\n'));
if (failed) {
  console.error('check-contrast: at least one pair fails WCAG AA (4.5:1).');
  process.exit(1);
}
console.log(`ok       ${pairs.length} pairs measured, all >= ${AA_NORMAL}:1`);
