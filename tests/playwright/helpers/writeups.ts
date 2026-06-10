// Resolves writeup URLs for the functional specs from the synced content
// snapshot instead of pinned slugs, so renaming a writeup in the vault cannot
// break the code gates. Each helper picks the alphabetically-first writeup
// satisfying a capability (deterministic across runs).
//
// The visual suite (visual.spec.ts) intentionally does NOT use these: its
// committed baselines protect specific pages, so it pins slugs and a rename
// there means re-pinning and re-baselining on purpose.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const writeupsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/content/writeups',
);

const slugs = fs
  .readdirSync(writeupsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(writeupsDir, entry.name, 'index.md')))
  .map((entry) => entry.name)
  .sort();

const bodies = new Map<string, string>();
function body(slug: string): string {
  if (!bodies.has(slug)) {
    bodies.set(slug, fs.readFileSync(path.join(writeupsDir, slug, 'index.md'), 'utf8'));
  }
  return bodies.get(slug)!;
}

function writeupWhere(predicate: (body: string) => boolean, description: string): string {
  const slug = slugs.find((candidate) => predicate(body(candidate)));
  if (!slug) {
    throw new Error(`no synced writeup ${description}; run \`npm run sync:content\` and check the vault`);
  }
  return `/portfolio/${slug}/`;
}

export const anyWriteup = () => writeupWhere(() => true, 'exists');

export const privateLinkWriteup = () =>
  writeupWhere((text) => text.includes('"private:'), 'with a private-link tooltip');

export const tableWriteup = () =>
  writeupWhere((text) => /^::table/m.test(text) || /^\|.+\|$/m.test(text), 'with a table block');

export const imageHeavyWriteup = () => {
  const counted = slugs
    .map((slug) => ({ slug, images: (body(slug).match(/!\[/g) ?? []).length }))
    .sort((a, b) => b.images - a.images || a.slug.localeCompare(b.slug));
  if (!counted.length || counted[0].images === 0) {
    throw new Error('no synced writeup contains images; run `npm run sync:content`');
  }
  return `/portfolio/${counted[0].slug}/`;
};
