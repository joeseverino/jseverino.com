// The technology catalog (06 Pages/_technology-groups.md, synced to
// src/content/technology-groups.md): one `## Group` section per group, each a
// `| Slug | Label | Featured |` table. One parser for the build, the sync check,
// and `site tech`.

export interface TechnologyTag {
  slug: string;
  label: string;
  featured: boolean;
}

export interface TechnologyGroup {
  name: string;
  tags: TechnologyTag[];
}

export function parseTechnologyGroups(body: string): TechnologyGroup[] {
  return body
    .split(/^##\s+/m)
    .slice(1)
    .map((section) => {
      const [nameLine = '', ...lines] = section.split('\n');
      const tags: TechnologyTag[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
        const cells = trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
        if (cells.length < 2) continue;
        const [slug, label, featured] = cells;
        if (!slug || !label) continue;
        if (slug.toLowerCase() === 'slug' && label.toLowerCase() === 'label') continue;
        if (/^:?-{2,}:?$/.test(slug)) continue;
        tags.push({ slug, label, featured: featured?.toLowerCase() === 'yes' });
      }
      return { name: nameLine.trim(), tags };
    })
    .filter((group) => group.name && group.tags.length > 0);
}
