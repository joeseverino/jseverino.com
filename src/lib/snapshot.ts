// The committed content snapshot under src/content, read straight from disk by
// the code that runs outside Astro's content layer: the config, the content
// index, seo-preview, and the specs.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, type ParsedFrontmatter } from './frontmatter.ts';
import { siteRoot } from './site-root.ts';

export interface SnapshotWriteup extends ParsedFrontmatter {
  slug: string;
  source: string;
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Every writeup directory with an index.md, in slug order.
export function snapshotWriteups(root = siteRoot): SnapshotWriteup[] {
  const dir = path.join(root, 'src/content/writeups');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'index.md')))
    .map((entry) => entry.name)
    .sort(byName)
    .map((slug) => {
      const source = fs.readFileSync(path.join(dir, slug, 'index.md'), 'utf8');
      return { slug, source, ...parseFrontmatter(source) };
    });
}

// Page slugs: src/content/pages/<slug>.md.
export function snapshotPageSlugs(root = siteRoot): string[] {
  const dir = path.join(root, 'src/content/pages');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith('.md')).map((file) => file.slice(0, -3)).sort(byName);
}
