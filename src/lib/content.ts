import fs from 'node:fs';
import path from 'node:path';
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { enhanceImages } from './images';
import { renderPageHtml, renderWriteupHtml } from './markdown';
import { site } from './site';

export type Writeup = {
  slug: string;
  title: string;
  description: string;
  date: string;
  lastReviewed?: string;
  technologies: string[];
  heroImage: string;
  heroAlt: string;
  bodyHtml: string;
  featured: boolean;
  featuredOrder?: number;
};

export type PageContent = {
  slug: string;
  title: string;
  description: string;
  intro?: string;
  path: string;
  body: string;
  bodyHtml: string;
};

export type TechnologyTag = {
  slug: string;
  label: string;
  featured: boolean;
};

export type TechnologyGroup = {
  name: string;
  tags: TechnologyTag[];
};

// Build-time memoization. Technology groups are intentionally not cached so
// dev edits to `src/content/technology-groups.md` show up without restarting
// the dev server; the parse is microseconds.
function memo<T>(): { get(load: () => T): T; getAsync(load: () => Promise<T>): Promise<T> } {
  let value: T | undefined;
  return {
    get(load) {
      if (value === undefined) value = load();
      return value;
    },
    async getAsync(load) {
      if (value === undefined) value = await load();
      return value;
    },
  };
}

const pagesCache = memo<CollectionEntry<'pages'>[]>();
const writeupsCache = memo<Writeup[]>();

function normalizeDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return '';
}

function resolveWriteupAsset(src: string | undefined, slug: string): string | undefined {
  if (!src) return undefined;
  if (/^https?:\/\//.test(src) || src.startsWith('/')) return src;
  return `/assets/writeups/${slug}/${src.replace(/^\.\//, '')}`;
}

function firstBodyImage(markdown: string, slug: string): string | undefined {
  const match = markdown.match(/!\[[^\]]*\]\(([^)]+)\)/);
  return resolveWriteupAsset(match?.[1], slug);
}

function renderWriteupMarkdown(markdown: string, slug: string): string {
  return enhanceImages(renderWriteupHtml(markdown, slug));
}

export function renderPageMarkdown(markdown: string): string {
  return enhanceImages(renderPageHtml(markdown));
}

function collectionSlug(id: string): string {
  return id.replace(/\/index\.md$/, '').replace(/\.md$/, '');
}

export async function getPage(slug: string): Promise<PageContent> {
  // Drafts render in `astro dev` (npm run dev:drafts) but never in a build.
  const pages = await pagesCache.getAsync(() =>
    getCollection('pages', (page) => import.meta.env.DEV || page.data.published),
  );
  const page = pages.find((entry) => collectionSlug(entry.id) === slug);
  if (!page) throw new Error(`Missing page content: ${slug}`);

  return {
    slug,
    title: page.data.title,
    description: page.data.description ?? '',
    intro: page.data.intro,
    path: page.data.path || (slug === 'home' ? '/' : `/${slug}/`),
    body: page.body ?? '',
    bodyHtml: renderPageMarkdown(page.body ?? ''),
  };
}

export function getTechnologyGroups(): TechnologyGroup[] {
  const file = path.resolve(process.cwd(), 'src/content/technology-groups.md');
  const body = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const sections = body.split(/^##\s+/m).slice(1);

  return sections
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
      `[technology-groups] Writeup frontmatter references tag slugs missing from src/content/technology-groups.md: ${list}`,
    );
  }
  warnedUnknownTechnologies = true;
}

export async function getWriteups(): Promise<Writeup[]> {
  return writeupsCache.getAsync(async () => {
    // Drafts render in `astro dev` (npm run dev:drafts) but never in a build.
    const entries = await getCollection(
      'writeups',
      (entry) => import.meta.env.DEV || entry.data.published === true,
    );

    const writeups = entries.map((entry) => {
      const slug = collectionSlug(entry.id);
      const heroImage =
        resolveWriteupAsset(entry.data.cover_image, slug) ??
        firstBodyImage(entry.body ?? '', slug) ??
        site.defaultOgImage;

      return {
        slug,
        title: entry.data.title,
        description: entry.data.description ?? '',
        date: normalizeDate(entry.data.published_at),
        lastReviewed: normalizeDate(entry.data.last_reviewed),
        technologies: entry.data.technologies,
        heroImage,
        heroAlt: entry.data.cover_alt?.trim() || entry.data.title,
        bodyHtml: renderWriteupMarkdown(entry.body ?? '', slug),
        featured: entry.data.featured,
        featuredOrder: entry.data.featured_order,
      } satisfies Writeup;
    });

    warnOnUnknownTechnologies(writeups);
    return writeups.sort((a, b) => b.date.localeCompare(a.date));
  });
}

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
