import fs from 'node:fs';
import path from 'node:path';

const stylesDir = path.resolve('src/styles');
const cssFiles = fs
  .readdirSync(stylesDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
  .map((entry) => path.join(entry.parentPath, entry.name));

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

  for (const match of css.matchAll(/var\(\s*(--[\w-]+)/g)) {
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
