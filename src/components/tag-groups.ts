import { getAllTags, getTechnologyGroups } from '@lib/content.ts';

const collator = new Intl.Collator('en', { sensitivity: 'base' });

export type TagGroup = Awaited<ReturnType<typeof groupedTags>>[number];

export async function groupedTags({ featuredOnly = false } = {}) {
  const counts = new Map((await getAllTags()).map((tag) => [tag.slug, tag.count]));
  return getTechnologyGroups()
    .map((group) => ({
      ...group,
      tags: group.tags
        .filter((tag) => counts.has(tag.slug) && (!featuredOnly || tag.featured))
        .map((tag) => ({ ...tag, count: counts.get(tag.slug) ?? 0 }))
        .sort((a, b) => collator.compare(a.label, b.label)),
    }))
    .filter((group) => group.tags.length > 0)
    .sort((a, b) => collator.compare(a.name, b.name));
}
