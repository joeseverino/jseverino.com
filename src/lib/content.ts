import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';

function createMarkdownRenderer() {
  return new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
  });
}

const md = createMarkdownRenderer();
const fragmentMd = createMarkdownRenderer();

md.renderer.rules.table_open = () =>
  '<figure class="table-figure table-figure--striped"><table class="table-fixed">';
md.renderer.rules.table_close = () => '</table></figure>';

export type Writeup = {
  slug: string;
  title: string;
  description: string;
  date: string;
  lastReviewed?: string;
  technologies: string[];
  heroImage: string;
  bodyHtml: string;
  featured: boolean;
  featuredOrder?: number;
};

export type PageContent = {
  slug: string;
  title: string;
  description: string;
  path: string;
  body: string;
  bodyHtml: string;
};

export type SiteChrome = {
  name: string;
  navItems: { href: string; label: string }[];
};

export type TechnologyTag = {
  slug: string;
  label: string;
};

export type TechnologyGroup = {
  name: string;
  tags: TechnologyTag[];
};

let pagesCache: CollectionEntry<'pages'>[] | undefined;
let writeupsCache: Writeup[] | undefined;
let siteChromeCache: SiteChrome | undefined;
// No module-level cache for technology groups: the source file is read on
// every call so dev edits to `src/content/technology-groups.md` show up
// without restarting the dev server. The parse is microseconds.

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

function stripArticleChrome(markdown: string): string {
  return markdown
    .trimStart()
    .replace(/^# .+(?:\r?\n)+/, '')
    .replace(/^>\s+.+(?:\r?\n)+/, '')
    .replace(/^!\[[^\]]*\]\([^)]+\)(?:\r?\n)+/, '')
    .trim();
}

function preprocessImageDirectives(markdown: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, altRaw: string, url: string) => {
      const parts = altRaw.split('|').map((p) => p.trim());
      let alt = parts[0] ?? '';
      let width: string | null = null;
      let nocap = false;

      for (const part of parts.slice(1)) {
        if (/^\d+$/.test(part)) width = part;
        else if (part.toLowerCase() === 'nocap' || part.toLowerCase() === 'nocaption') nocap = true;
      }

      if (!width && !nocap && alt === altRaw) return match;

      const attrs = [
        `src="${url}"`,
        `alt="${alt.replace(/"/g, '&quot;')}"`,
        width ? `width="${width}"` : '',
        nocap ? 'data-nocap' : '',
        alt ? 'data-has-alt-caption' : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `<img ${attrs}>`;
    },
  );
}

function renderFigureBlocks(markdown: string): string {
  return markdown.replace(blockRe('figure'), (_match, content: string) => {
    const lines = content.trim().split(/\r?\n/);
    const imageIndex = lines.findIndex((line) => line.trim() !== '');
    if (imageIndex === -1) return '';

    const imageLine = lines[imageIndex].trim();
    const image = imageLine.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
    if (!image) return md.render(content.trim());

    const [, altRaw, src] = image;
    const captionMarkdown = lines.slice(imageIndex + 1).join('\n').trim();
    const alt = altRaw.replace(/"/g, '&quot;');
    const caption = captionMarkdown ? md.renderInline(captionMarkdown) : '';

    return [
      '<figure>',
      `<img src="${src}" alt="${alt}">`,
      caption ? `<figcaption>${caption}</figcaption>` : '',
      '</figure>',
    ]
      .filter(Boolean)
      .join('');
  });
}

function renderTableBlocks(markdown: string): string {
  return markdown.replace(blockRe('table'), (_match, content: string) => {
    const lines = content.trim().split(/\r?\n/);
    const tableLines = [];
    const captionLines = [];
    let inCaption = false;

    for (const line of lines) {
      if (!inCaption && line.trim() !== '' && line.trim().startsWith('|')) {
        tableLines.push(line);
        continue;
      }

      if (line.trim() !== '') inCaption = true;
      if (inCaption) captionLines.push(line);
    }

    if (tableLines.length === 0) return md.render(content.trim());

    const table = fragmentMd
      .render(tableLines.join('\n'))
      .trim()
      .replace('<table>', '<table class="table-fixed">');
    const captionMarkdown = captionLines.join('\n').trim();
    const caption = captionMarkdown ? md.renderInline(captionMarkdown) : '';

    return [
      '<figure class="table-figure table-figure--striped">',
      table,
      caption ? `<figcaption>${caption}</figcaption>` : '',
      '</figure>',
    ]
      .filter(Boolean)
      .join('');
  });
}

function restoreFigures(html: string): string {
  // Pass 1: image with explicit caption from alt text → figure, drop next-paragraph absorption.
  let result = html.replace(
    /<p><img([^>]*?)data-has-alt-caption([^>]*)><\/p>/g,
    (_match, before: string, after: string) => {
      const attrs = `${before}${after}`.replace(/\s+/g, ' ').trim();
      const altMatch = attrs.match(/alt="([^"]*)"/);
      const caption = altMatch?.[1] ?? '';
      const cleaned = attrs.replace(/\s*data-nocap\b/, '');
      return `<figure><img ${cleaned}><figcaption>${caption}</figcaption></figure>`;
    },
  );

  // Pass 2: image with data-nocap → keep image, leave next paragraph alone.
  result = result.replace(
    /<p><img([^>]*?)data-nocap([^>]*)><\/p>/g,
    (_match, before: string, after: string) => {
      const cleaned = `${before}${after}`.replace(/\s+/g, ' ').trim();
      return `<p><img ${cleaned}></p>`;
    },
  );

  return result;
}

function promoteStandaloneLinks(html: string): string {
  return html.replace(
    /<p><a href="([^"]+)"([^>]*)>([^<]+)<\/a><\/p>/g,
    (_match, href: string, attrs: string, text: string) =>
      `<div class="actions"><a class="button" href="${href}"${attrs}>${text}</a></div>`,
  );
}

function renderButton(match: string, classes = ''): string {
  const link = match.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (!link) return '';
  const className = `button ${classes}`.trim();
  return `<div class="actions"><a class="${className}" href="${link[2]}">${link[1]}</a></div>`;
}

const blockClose = String.raw`\n::(?=\r?\n|$)`;
const blockRe = (name: string) => new RegExp(String.raw`::${name}\n([\s\S]*?)${blockClose}`, 'g');

function renderButtons(markdown: string): string {
  return markdown.replace(blockRe('buttons'), (_, links: string) => {
    const buttons = [...links.matchAll(/- \[([^\]]+)\]\(([^)]+)\)/g)]
      .map((match, index) => {
        const className = index === 0 ? 'button' : 'button secondary';
        return `<a class="${className}" href="${match[2]}">${match[1]}</a>`;
      })
      .join('\n');
    return `<div class="actions">${buttons}</div>`;
  });
}

function renderCenter(markdown: string): string {
  return markdown.replace(blockRe('center'), (_, content: string) => {
    const inner = restoreFigures(md.render(content.trim()));
    return `\n\n<div class="center-text">${inner}</div>\n\n`;
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTerminal(markdown: string): string {
  return markdown.replace(blockRe('terminal'), (_, content: string) => {
    const lines = content.replace(/\r?\n$/, '').split(/\r?\n/);
    const rendered = lines
      .map((line) => {
        if (line === '') return '';
        if (/^\$\s?/.test(line)) {
          const cmd = line.replace(/^\$\s?/, '');
          return `<span class="line"><span class="prompt">$</span> <span class="cmd">${escapeHtml(cmd)}</span></span>`;
        }
        return `<span class="line out">${escapeHtml(line)}</span>`;
      })
      .join('\n');
    return `\n\n<div class="terminal-block"><div class="terminal-bar"><span class="terminal-dots" aria-hidden="true"></span><span class="terminal-label">TERMINAL</span></div><pre><code>${rendered}</code></pre></div>\n\n`;
  });
}

function renderSplit(markdown: string): string {
  return markdown.replace(blockRe('split'), (_, content: string) => {
    const parts = content.split(/^:::\s*$/m);
    if (parts.length < 2) {
      const inner = restoreFigures(md.render(content.trim()));
      return `\n\n<div class="split">${inner}</div>\n\n`;
    }
    const [left, ...rest] = parts;
    const right = rest.join(':::');
    const leftHtml = restoreFigures(md.render(left.trim()));
    const rightHtml = restoreFigures(md.render(right.trim()));
    return `\n\n<div class="split"><div>${leftHtml}</div><div>${rightHtml}</div></div>\n\n`;
  });
}

function preprocessPageMarkdown(markdown: string): string {
  const withInlineDirectives = renderButtons(markdown)
    .replace(/::featured-projects\s*::/g, '<div data-content-block="featured-projects"></div>')
    .replace(/::technology-cloud\s*::/g, '<div data-content-block="technology-cloud"></div>')
    .replace(blockRe('button sticky'), (_, button: string) => renderButton(button, 'sticky-button'))
    .replace(blockRe('button'), (_, button: string) => renderButton(button));

  return renderSplit(renderCenter(renderTerminal(withInlineDirectives)));
}

function renderWriteupMarkdown(markdown: string, slug: string): string {
  const prepared = renderTableBlocks(renderFigureBlocks(renderTerminal(preprocessImageDirectives(stripArticleChrome(markdown)))));
  const html = md.render(prepared);
  return promoteStandaloneLinks(restoreFigures(html))
    .replace(/language-[^"]*block-code/g, 'language-shell')
    .replaceAll('src="./images/', `src="/assets/writeups/${slug}/images/`)
    .replaceAll('src="images/', `src="/assets/writeups/${slug}/images/`);
}

export function renderPageMarkdown(markdown: string): string {
  return restoreFigures(md.render(preprocessPageMarkdown(markdown)));
}

function collectionSlug(id: string): string {
  return id.replace(/\/index\.md$/, '').replace(/\.md$/, '');
}

export async function getPage(slug: string): Promise<PageContent> {
  const pages =
    pagesCache ??
    (pagesCache = await getCollection(
      'pages',
      // Drafts render in `astro dev` (npm run dev:drafts) but never in a build.
      (page) => import.meta.env.DEV || page.data.published,
    ));
  const page = pages.find((entry) => collectionSlug(entry.id) === slug);
  if (!page) throw new Error(`Missing page content: ${slug}`);

  return {
    slug,
    title: page.data.title,
    description: page.data.description ?? '',
    path: page.data.path,
    body: page.body ?? '',
    bodyHtml: renderPageMarkdown(page.body ?? ''),
  };
}

export function getSiteChrome(): SiteChrome {
  if (siteChromeCache) return siteChromeCache;

  const file = path.resolve(process.cwd(), 'src/content/site.md');
  const body = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Joe Severino';
  const name = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Joe Severino';
  const navItems = [...body.matchAll(/^- \[([^\]]+)\]\(([^)]+)\)$/gm)].map((match) => ({
    label: match[1],
    href: match[2],
  }));

  siteChromeCache = { name, navItems };
  return siteChromeCache;
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
        const [slug, label] = cells;
        if (!slug || !label) continue;
        if (slug.toLowerCase() === 'slug' && label.toLowerCase() === 'label') continue;
        if (/^:?-{2,}:?$/.test(slug)) continue;
        tags.push({ slug, label });
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
  if (writeupsCache) return writeupsCache;

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
      '/assets/media/2025/08/cropped-JS-2-192x192.png';

    return {
      slug,
      title: entry.data.title,
      description: entry.data.description ?? '',
      date: normalizeDate(entry.data.published_at),
      lastReviewed: normalizeDate(entry.data.last_reviewed),
      technologies: entry.data.technologies,
      heroImage,
      bodyHtml: renderWriteupMarkdown(entry.body ?? '', slug),
      featured: entry.data.featured,
      featuredOrder: entry.data.featured_order,
    } satisfies Writeup;
  });

  warnOnUnknownTechnologies(writeups);

  writeupsCache = writeups.sort((a, b) => b.date.localeCompare(a.date));
  return writeupsCache;
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
