import assert from 'node:assert/strict';
import path from 'node:path';
import { after, test } from 'node:test';
import { spawnResult } from '../../bin/lib/run.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const dirs = scratchDirs('client-script-plugins-');
after(dirs.cleanup);

// The client-script rules biome.jsonc applies to src/, run over one file. An .astro file's
// frontmatter and <script> elements reach a JavaScript plugin only through Biome's full HTML
// support, so a fixture of each kind holds the rules to the files they guard.
function flagged(file: string, source: string): string[] {
  const dir = dirs.make();
  const config = {
    root: true,
    html: { experimentalFullSupportEnabled: true },
    plugins: ['client-html-sinks', 'view-transition-hooks'].map((name) => path.join(siteRoot, `tests/${name}.grit`)),
    linter: { rules: { preset: 'none' } },
  };
  write(path.join(dir, 'biome.json'), JSON.stringify(config));
  write(path.join(dir, file), source);
  // From the checkout, where mise resolves the pinned Biome; the config is the scratch one.
  const result = spawnResult('biome', ['lint', `--config-path=${dir}`, '--reporter=rdjson', path.join(dir, file)], { cwd: siteRoot });
  assert.equal(result.error, undefined, result.error);
  const { diagnostics }: { diagnostics: { location: { range: { start: { line: number } } } }[] } = JSON.parse(result.stdout);
  const lines = source.split('\n');
  return diagnostics.map(({ location }) => lines[location.range.start.line - 1]?.trim() ?? '');
}

test('an innerHTML or outerHTML assignment and an insertAdjacentHTML call are refused', () => {
  const source = [
    "document.body.innerHTML = '<b>x</b>';",
    "document.body.firstElementChild!.outerHTML += '<i>y</i>';",
    "document.body.insertAdjacentHTML('beforeend', '<hr>');",
    '',
  ];
  assert.deepEqual(flagged('fixture.ts', source.join('\n')), source.slice(0, 3));
});

test('reading the markup and assigning text pass', () => {
  const source = ['const markup = document.body.innerHTML;', 'document.body.textContent = markup;', ''];
  assert.deepEqual(flagged('fixture.ts', source.join('\n')), []);
});

test("a listener for Astro's after-swap event is refused", () => {
  assert.deepEqual(flagged('fixture.ts', "document.addEventListener('astro:after-swap', () => {});\n"), [
    "document.addEventListener('astro:after-swap', () => {});",
  ]);
});

test('both rules reach an .astro file, in its frontmatter and in a <script> element', () => {
  const source = [
    '---',
    "document.body.innerHTML = '';",
    '---',
    '<div></div>',
    '<script>',
    "  document.addEventListener('astro:after-swap', () => {});",
    "  document.addEventListener('DOMContentLoaded', () => {});",
    '</script>',
    '',
  ];
  assert.deepEqual(flagged('Fixture.astro', source.join('\n')), [source[1], source[5]?.trim()]);
});
