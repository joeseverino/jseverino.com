import assert from 'node:assert/strict';
import path from 'node:path';
import { after, test } from 'node:test';
import { spawnResult } from '../../bin/lib/run.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const dirs = scratchDirs('literal-colors-');
after(dirs.cleanup);

// Biome's rdjson report (reviewdog's diagnostic format).
interface Diagnostic {
  code: { value: string };
  location: { range: { start: { line: number; column: number }; end: { line: number; column: number } } };
}

// The literal-color rules biome.jsonc applies to src/styles, run over one stylesheet. The plugin
// matches Biome's CSS syntax tree by node name, so a Biome release that renames a node would
// otherwise leave it matching nothing.
function flagged(css: string): string[] {
  const dir = dirs.make();
  const config = {
    root: true,
    plugins: [path.join(siteRoot, 'tests/literal-colors.grit')],
    linter: { rules: { preset: 'none', style: { noHexColors: 'error' } } },
  };
  write(path.join(dir, 'biome.json'), JSON.stringify(config));
  write(path.join(dir, 'fixture.css'), css);
  // From the checkout, where mise resolves the pinned Biome; the config is the scratch one.
  const result = spawnResult('biome', ['lint', `--config-path=${dir}`, '--reporter=rdjson', path.join(dir, 'fixture.css')], { cwd: siteRoot });
  assert.equal(result.error, undefined, result.error?.message);
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
