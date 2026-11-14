import assert from 'node:assert/strict';
import { test } from 'node:test';
import { biomeFindings } from './helpers/biome.ts';

// The client-script rules biome.jsonc applies to src/, run over one file. An .astro file's
// frontmatter and <script> elements reach a JavaScript plugin only through Biome's full HTML
// support, so a fixture of each kind holds the rules to the files they guard.
const flagged = (file: string, source: string): string[] =>
  biomeFindings(['client-html-sinks', 'view-transition-hooks'], file, source, { html: { experimentalFullSupportEnabled: true } }).map(({ line }) => line);

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
