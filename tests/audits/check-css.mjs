import fs from 'node:fs';
import path from 'node:path';

const srcDir = path.resolve('src');
const listFiles = (dir, pattern) => fs
  .readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && pattern.test(entry.name))
  .map((entry) => path.join(entry.parentPath, entry.name));

// Definitions come from the stylesheets; usages can live anywhere in src/ —
// a var(--x) in an .astro template or a JS string still justifies the token.
const cssFiles = listFiles(path.join(srcDir, 'styles'), /\.css$/);
const codeFiles = listFiles(srcDir, /\.(astro|ts|js|mjs)$/);

const definitions = new Map();
const usages = new Set();

for (const file of cssFiles) {
  const css = fs.readFileSync(file, 'utf8');

  for (const match of css.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)) {
    const line = css.slice(0, match.index).split('\n').length;
    const locations = definitions.get(match[1]) ?? [];
    locations.push(`${path.relative(process.cwd(), file)}:${line}`);
    definitions.set(match[1], locations);
  }
}

for (const file of [...cssFiles, ...codeFiles]) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/var\(\s*(--[\w-]+)/g)) {
    usages.add(match[1]);
  }
}

const unused = [...definitions]
  .filter(([property]) => !usages.has(property))
  .sort(([left], [right]) => left.localeCompare(right));

if (unused.length > 0) {
  console.error('Unused CSS custom properties:');
  for (const [property, locations] of unused) {
    console.error(`  ${property} (${locations.join(', ')})`);
  }
  process.exitCode = 1;
} else {
  console.log(`CSS custom-property audit passed (${definitions.size} properties).`);
}
