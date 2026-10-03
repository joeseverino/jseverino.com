import fs from 'node:fs';
import path from 'node:path';
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { enhanceImages } from './images.ts';
import { renderPageHtml, renderWriteupHtml } from './markdown.ts';
import { site } from './site.ts';
import { asyncCache } from './async-cache.ts';
import { contentRoot } from './content-root.ts';
import { parseTechnologyGroups, type TechnologyGroup } from './technology-groups.ts';
import { isoDate } from './dates.ts';

export type { TechnologyGroup, TechnologyTag } from './technology-groups.ts';

export type Writeup = {
  slug: string;
  title: string;
  description: string;
  date: string;
  lastReviewed?: string | undefined;
  technologies: string[];
  heroImage: string;
  heroAlt: string;
  bodyHtml: string;
  featured: boolean;
  featuredOrder?: number | undefined;
};

export type PageContent = {
  slug: string;
  title: string;
  description: string;
  intro?: string | undefined;
  path: string;
  body: string;
  bodyHtml: string;
};

function normalizeDate(value: unknown): string {
  if (value instanceof Date) return isoDate(value);
  if (typeof value === 'string') return value.slice(0, 10);
  return '';
}

// The sync rewrites every local reference (body and cover_image) to its
// public /assets/ URL, so content arrives here already resolved.
function firstBodyImage(markdown: string): string | undefined {
  return markdown.match(/!\[[^\]]*\]\(([^)\s]+)/)?.[1];
}

function renderWriteupMarkdown(markdown: string): string {
  return enhanceImages(renderWriteupHtml(markdown));
}

export function renderPageMarkdown(markdown: string): string {
  return enhanceImages(renderPageHtml(markdown));
}

function collectionSlug(id: string): string {
  return id.replace(/\/index\.md$/, '').replace(/\.md$/, '');
}

const loadPages = asyncCache(() => {
  // Drafts render in `site dev --drafts` (a gitignored overlay) but never in a build.
  return getCollection('pages', (page) => import.meta.env.DEV || page.data.published);
});

function toPageContent(entry: CollectionEntry<'pages'>): PageContent {
  const slug = collectionSlug(entry.id);
  return {
    slug,
    title: entry.data.title,
    description: entry.data.description ?? '',
    intro: entry.data.intro,
    path: entry.data.path || (slug === 'home' ? '/' : `/${slug}/`),
    body: entry.body ?? '',
    bodyHtml: renderPageMarkdown(entry.body ?? ''),
  };
}

export async function getPage(slug: string): Promise<PageContent> {
  const page = (await loadPages()).find((entry) => collectionSlug(entry.id) === slug);
  if (!page) throw new Error(`Missing page content: ${slug}`);
  return toPageContent(page);
}

// Institution detail pages generated under `education/` by sync-content,
// one per Education-vault institution joined to the resume canonical.
export async function getEducationInstitutions(): Promise<PageContent[]> {
  const pages = await loadPages();
  return pages
    .filter((entry) => collectionSlug(entry.id).startsWith('education/'))
    .map(toPageContent);
}

// Parse on demand so dev edits appear without restarting the server.
export function getTechnologyGroups(): TechnologyGroup[] {
  const file = path.resolve(process.cwd(), contentRoot, 'technology-groups.md');
  return parseTechnologyGroups(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
}

function getTechnologyLabel(slug: string): string | undefined {
  for (const group of getTechnologyGroups()) {
    for (const tag of group.tags) if (tag.slug === slug) return tag.label;
  }
  return undefined;
}

let warnedUnknownTechnologies = false;

function warnOnUnknownTechnologies(writeups: Writeup[]): void {
  if (warnedUnknownTechnologies) return;
  const known = new Set<string>();
  for (const group of getTechnologyGroups()) {
    for (const tag of group.tags) known.add(tag.slug);
  }
  const unknown = new Set<string>();
  for (const writeup of writeups) {
    for (const tag of writeup.technologies) {
      if (!known.has(tag)) unknown.add(tag);
    }
  }
  if (unknown.size > 0) {
    const list = [...unknown].sort().join(', ');
    console.warn(
      `[technology-groups] Writeup frontmatter references tag slugs missing from ${contentRoot}/technology-groups.md: ${list}`,
    );
  }
  warnedUnknownTechnologies = true;
}

export const getWriteups = asyncCache<Writeup[]>(async () => {
  // Drafts render in `site dev --drafts` (a gitignored overlay) but never in a build.
  const entries = await getCollection(
    'writeups',
    (entry) => import.meta.env.DEV || entry.data.published === true,
  );

  const writeups = entries.map((entry) => {
    const slug = collectionSlug(entry.id);
    const heroImage = entry.data.cover_image || firstBodyImage(entry.body ?? '') || site.defaultOgImage;

    return {
      slug,
      title: entry.data.title,
      description: entry.data.description ?? '',
      date: normalizeDate(entry.data.published_at),
      lastReviewed: normalizeDate(entry.data.last_reviewed),
      technologies: entry.data.technologies,
      heroImage,
      heroAlt: entry.data.cover_alt?.trim() || entry.data.title,
      bodyHtml: renderWriteupMarkdown(entry.body ?? ''),
      featured: entry.data.featured,
      featuredOrder: entry.data.featured_order,
    } satisfies Writeup;
  });

  warnOnUnknownTechnologies(writeups);
  return writeups.sort((a, b) => b.date.localeCompare(a.date));
});

export async function getFeaturedWriteups(): Promise<Writeup[]> {
  const all = await getWriteups();
  return all
    .filter((writeup) => writeup.featured)
    .sort((a, b) => {
      const orderA = a.featuredOrder ?? Number.POSITIVE_INFINITY;
      const orderB = b.featuredOrder ?? Number.POSITIVE_INFINITY;
      if (orderA !== orderB) return orderA - orderB;
      return b.date.localeCompare(a.date);
    });
}

export async function getAllTags(): Promise<{ slug: string; label: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const writeup of await getWriteups()) {
    for (const tag of writeup.technologies) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, label: titleCase(slug), count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function titleCase(value: string): string {
  const label = getTechnologyLabel(value);
  if (label) return label;

  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatDate(value: string): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}
