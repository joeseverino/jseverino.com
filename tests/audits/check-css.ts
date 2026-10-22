import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../../src/lib/site-root.ts';
import { abort, finish } from './lib.ts';

const srcDir = path.join(siteRoot, 'src');
const listFiles = (dir: string, pattern: RegExp): string[] =>
  fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((file) => pattern.test(file)).map((file) => path.join(dir, file));

// Definitions come from the stylesheets; usages can live anywhere in src/:
// a var(--x) in an .astro template or a JS string still justifies the token.
const cssFiles = listFiles(path.join(srcDir, 'styles'), /\.css$/);
const codeFiles = listFiles(srcDir, /\.(astro|ts)$/);
if (cssFiles.length === 0) abort('check-css', 'no stylesheets under src/styles');

const definitions = new Map<string, string[]>();
const usages = new Set<string>();

for (const file of cssFiles) {
  const css = fs.readFileSync(file, 'utf8');

  for (const match of css.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)) {
    const property = match[1] ?? '';
    const line = css.slice(0, match.index).split('\n').length;
    const locations = definitions.get(property) ?? [];
    locations.push(`${path.relative(process.cwd(), file)}:${line}`);
    definitions.set(property, locations);
  }
}

for (const file of [...cssFiles, ...codeFiles]) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [, property = ''] of source.matchAll(/var\(\s*(--[\w-]+)/g)) usages.add(property);
}

const unused = [...definitions]
  .filter(([property]) => !usages.has(property))
  .sort(([left], [right]) => left.localeCompare(right));

finish(
  unused.map(([property, locations]) => `${property} (${locations.join(', ')})`),
  `${definitions.size} CSS custom properties, all referenced`,
  { heading: 'Unused CSS custom properties:', fix: 'fix: remove the property from src/styles/, or add the var(...) use that needs it' },
);
