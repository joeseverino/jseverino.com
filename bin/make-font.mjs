#!/usr/bin/env node
// make-font — emit the one webfont the site ships.
//
// Inter's variable release carries every script and a 100–900 weight axis;
// the site sets Latin text at weights 400–700, so everything else is bytes
// the LCP image competes with on a slow connection. This subsets the glyphs
// to the characters the content uses (typographer punctuation, arrows) and
// clamps the weight axis, keeping the optical-size axis so headings still
// pick up Inter Display. The recipe lives here so the font is reproducible
// rather than a binary of unknown provenance.
//
//   node bin/make-font.mjs                       # re-subset the committed font
//   node bin/make-font.mjs --source Inter.woff2  # from an upstream Inter release
//
// Needs python3 with fontTools and brotli (`pip install fonttools brotli`),
// the same way make:icons needs the optional branding engine.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fromRoot } from '../src/lib/site-root.mjs';

export const FONT_PATH = 'public/assets/fonts/inter/inter-variable-latin.woff2';
export const WEIGHT_RANGE = [400, 700];
// Basic Latin, Latin-1, the ligature and dotless-i glyphs Inter's kerning
// expects, general punctuation (typographer quotes, dashes, bullet, ellipsis),
// the arrows the writeups use, and the replacement character.
export const UNICODES = [
  'U+0020-007E',
  'U+00A0-00FF',
  'U+0131',
  'U+0152-0153',
  'U+2000-200B',
  'U+2010-2015',
  'U+2018-201F',
  'U+2020-2022',
  'U+2026',
  'U+2030',
  'U+2039-203A',
  'U+2044',
  'U+20AC',
  'U+2122',
  'U+2190-2199',
  'U+2212',
  'U+2215',
  'U+FEFF',
  'U+FFFD',
];

const python = String.raw`
import json, sys
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib import instancer

spec = json.loads(sys.argv[1])
font = TTFont(spec["source"])
options = subset.Options()
options.layout_features = ["*"]
options.name_IDs = ["*"]
options.notdef_outline = True
subsetter = subset.Subsetter(options)
subsetter.populate(unicodes=subset.parse_unicodes(",".join(spec["unicodes"])))
subsetter.subset(font)
font = instancer.instantiateVariableFont(font, {"wght": tuple(spec["weights"])}, inplace=False, updateFontNames=False)
font.flavor = "woff2"
font.save(spec["target"])
axes = [(a.axisTag, a.minValue, a.maxValue) for a in font["fvar"].axes]
print(json.dumps({"glyphs": len(font.getGlyphOrder()), "axes": axes}))
`;

const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source');
const target = fromRoot(FONT_PATH);
const source = sourceIndex >= 0 ? args[sourceIndex + 1] : target;
if (!source || !fs.existsSync(source)) {
  console.error(`make-font: source font not found: ${source}`);
  process.exit(1);
}

const before = fs.statSync(source).size;
const result = spawnSync(
  'python3',
  ['-', JSON.stringify({ source, target, unicodes: UNICODES, weights: WEIGHT_RANGE })],
  { input: python, encoding: 'utf8' },
);
if (result.status !== 0) {
  const missing = /No module named/.test(result.stderr);
  console.error(missing ? 'make-font: needs python3 with fontTools and brotli: pip install fonttools brotli' : result.stderr.trim());
  process.exit(1);
}

const { glyphs, axes } = JSON.parse(result.stdout.trim().split('\n').at(-1));
const after = fs.statSync(target).size;
console.log(
  `wrote ${FONT_PATH}: ${(after / 1024).toFixed(1)} kB (source ${(before / 1024).toFixed(1)} kB), ${glyphs} glyphs, axes ${axes.map(([tag, min, max]) => `${tag} ${min}–${max}`).join(', ')}`,
);
