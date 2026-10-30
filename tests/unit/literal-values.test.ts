import assert from 'node:assert/strict';
import path from 'node:path';
import { after, test } from 'node:test';
import { spawnResult } from '../../bin/lib/run.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const dirs = scratchDirs('literal-values-');
after(dirs.cleanup);

// Biome's rdjson report (reviewdog's diagnostic format).
interface Diagnostic {
  code: { value: string };
  location: { range: { start: { line: number; column: number }; end: { line: number; column: number } } };
}

// The literal-color and literal-font-size rules biome.jsonc applies to src/styles, run over one
// stylesheet. The plugins match Biome's CSS syntax tree by node name, so a Biome release that
// renames a node would otherwise leave them matching nothing.
function flagged(css: string): string[] {
  const dir = dirs.make();
  const config = {
    root: true,
    plugins: ['literal-colors', 'literal-font-sizes'].map((name) => path.join(siteRoot, `tests/${name}.grit`)),
    linter: { rules: { preset: 'none', style: { noHexColors: 'error' } } },
  };
  write(path.join(dir, 'biome.json'), JSON.stringify(config));
  write(path.join(dir, 'fixture.css'), css);
  // From the checkout, where mise resolves the pinned Biome; the config is the scratch one.
  const result = spawnResult('biome', ['lint', `--config-path=${dir}`, '--reporter=rdjson', path.join(dir, 'fixture.css')], { cwd: siteRoot });
  assert.equal(result.error, undefined, result.error);
  const lines = css.split('\n');
  const { diagnostics }: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
  return diagnostics.map(({ code, location: { range } }) => {
    assert.equal(range.start.line, range.end.line);
    return `${code.value} ${lines[range.start.line - 1]?.slice(range.start.column - 1, range.end.column - 1)}`;
  });
}

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
