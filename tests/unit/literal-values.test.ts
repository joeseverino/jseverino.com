import assert from 'node:assert/strict';
import { test } from 'node:test';
import { biomeFindings } from './helpers/biome.ts';

// The literal-color and literal-font-size rules biome.jsonc applies to src/styles, run over one
// stylesheet. The plugins match Biome's CSS syntax tree by node name, so a Biome release that
// renames a node would otherwise leave them matching nothing.
const flagged = (css: string): string[] =>
  biomeFindings(['literal-colors', 'literal-font-sizes'], 'fixture.css', css, { linter: { rules: { preset: 'none', style: { noHexColors: 'error' } } } }).map(
    ({ rule, text }) => `${rule} ${text}`,
  );

test('a hex color, an rgb() or hsl() call, and a named color are each refused', () => {
  const css = [
    '.a {',
    '  color: #fff;',
    '  background: rgb(0 0 0);',
    '  border-color: HSLA(0 0% 0% / 50%);',
    '  outline-color: Red;',
    '  --accent: navy;',
    '}',
    '',
  ];
  assert.deepEqual(flagged(css.join('\n')).sort(), [
    'lint/style/noHexColors #fff',
    'plugin HSLA(0 0% 0% / 50%)',
    'plugin Red',
    'plugin navy',
    'plugin rgb(0 0 0)',
  ]);
});

test('every named color in one value is refused, inside a function too', () => {
  assert.deepEqual(flagged('.a {\n  background-image: linear-gradient(blue, white);\n}\n'), ['plugin blue', 'plugin white']);
});

test('tokens, color-mix(), system colors, and a color word naming something else pass', () => {
  const css = [
    '#red .tan {',
    '  color: var(--color-primary);',
    '  fill: currentcolor;',
    '  stroke: Highlight;',
    '  box-shadow: 0 0 0 color-mix(in oklch, var(--a), transparent);',
    '  animation-name: tan;',
    '  font-family: Gold, sans-serif;',
    '  grid-area: red;',
    '}',
    '',
  ];
  assert.deepEqual(flagged(css.join('\n')), []);
});

test('a rem, px or em font size is refused, in font-size and the font shorthand', () => {
  const css = ['.a {', '  font-size: 1.25rem;', '  font: 600 14PX/1.2 serif;', '  font-size: calc(1rem + 2px);', '  font-size: 0.9em;', '}', ''];
  assert.deepEqual(flagged(css.join('\n')).sort(), ['plugin 0.9em', 'plugin 1.25rem', 'plugin 14PX', 'plugin 1rem', 'plugin 2px']);
});

test('a font token, a token definition, and a length on another property pass', () => {
  const css = [
    '.a {',
    '  font-size: var(--font-sm);',
    '  font: 600 var(--font-body) / 1.4 var(--font-family-sans);',
    '  --font-xl: 2rem;',
    '  line-height: 1.5em;',
    '  padding: 1rem;',
    '}',
    '',
  ];
  assert.deepEqual(flagged(css.join('\n')), []);
});
