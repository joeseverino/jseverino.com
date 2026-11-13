import assert from 'node:assert/strict';
import path from 'node:path';
import { after, test } from 'node:test';
import { spawnResult } from '../../bin/lib/run.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const dirs = scratchDirs('type-escapes-');
after(dirs.cleanup);

type Diagnostic = { code: { value: string }; location: { path: string; range: { start: { line: number } } } };

// tests/type-escapes.grit alone, through Biome's full HTML support so an .astro file's
// frontmatter and <script> elements reach it, over the paths given.
function escapes(paths: string[]): Diagnostic[] {
  const dir = dirs.make();
  const config = {
    root: true,
    html: { experimentalFullSupportEnabled: true },
    plugins: [path.join(siteRoot, 'tests/type-escapes.grit')],
    linter: { rules: { preset: 'none' } },
  };
  write(path.join(dir, 'biome.json'), JSON.stringify(config));
  // From the checkout, where mise resolves the pinned Biome; the config is the scratch one.
  const result = spawnResult('biome', ['lint', `--config-path=${dir}`, '--reporter=rdjson', '--max-diagnostics=none', ...paths], { cwd: siteRoot });
  assert.equal(result.error, undefined, result.error);
  const { diagnostics }: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
  // The scratch config leaves the stylesheets' suppressions of the site's own rules unused.
  return diagnostics.filter(({ code }) => code.value === 'plugin');
}

function flagged(file: string, lines: string[]): string[] {
  const fixture = path.join(dirs.make(), file);
  write(fixture, lines.join('\n'));
  return escapes([fixture]).map(({ location }) => lines[location.range.start.line - 1]?.trim() ?? '');
}

test('a cast to never or through unknown is refused, and a cast to a named type is not', () => {
  const lines = [
    'const anything = JSON.parse(text) as never;',
    'const widened = (window as unknown as { turnstile: object }).turnstile;',
    'const typed = JSON.parse(text) as { ok: boolean };',
    'const unchecked = JSON.parse(text) as unknown;',
    '',
  ];
  assert.deepEqual(flagged('fixture.ts', lines), lines.slice(0, 2));
});

test('the rule reaches an .astro file, in its frontmatter and in a <script> element', () => {
  const lines = [
    '---',
    'const props = Astro.props as never;',
    '---',
    '<script>',
    '  const box = document.body as unknown as HTMLDialogElement;',
    '</script>',
    '',
  ];
  assert.deepEqual(flagged('Fixture.astro', lines), [lines[1], lines[4]?.trim()]);
});

test('src/ casts through neither never nor unknown', () => {
  assert.deepEqual(
    escapes(['src']).map(({ location }) => `${location.path}:${location.range.start.line}`),
    [],
  );
});
