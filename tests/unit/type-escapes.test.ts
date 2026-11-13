import assert from 'node:assert/strict';
import { test } from 'node:test';
import { biomeFindings } from './helpers/biome.ts';

// Full HTML support is what brings an .astro file's frontmatter and <script> elements to the rule.
const flagged = (file: string, lines: string[]): string[] =>
  biomeFindings(['type-escapes'], file, lines.join('\n'), { html: { experimentalFullSupportEnabled: true } }).map(({ line }) => line);

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
