// Parser for the technology catalog: one `## Group` section per group, each a `| Slug | Label | Featured |` table.

import fs from 'node:fs';

export interface TechnologyTag {
  slug: string;
  label: string;
  featured: boolean;
}

export interface TechnologyGroup {
  name: string;
  tags: TechnologyTag[];
}

// One table row as a tag; the header row, the delimiter row and anything not a row are not tags.
function tagOf(line: string): TechnologyTag | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return undefined;
  const [slug, label, featured] = trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
  if (!slug || !label) return undefined;
  if (slug.toLowerCase() === 'slug' && label.toLowerCase() === 'label') return undefined;
  if (/^:?-{2,}:?$/.test(slug)) return undefined;
  return { slug, label, featured: featured?.toLowerCase() === 'yes' };
}

export function parseTechnologyGroups(body: string): TechnologyGroup[] {
  return body
    .split(/^##\s+/m)
    .slice(1)
    .map((section) => {
      const [nameLine = '', ...lines] = section.split('\n');
      return { name: nameLine.trim(), tags: lines.map(tagOf).filter((tag) => tag !== undefined) };
    })
    .filter((group) => group.name && group.tags.length > 0);
}

export const readTechnologyGroups = (file: string): TechnologyGroup[] => parseTechnologyGroups(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
