import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

const contactFormHtml = `<div class="contact-intake">
  <form class="contact-intake-form" method="post" action="/contact/">
    <div class="contact-field">
      <label for="contact-name">Name</label>
      <input type="text" id="contact-name" name="name" autocomplete="name" required maxlength="190" />
    </div>
    <div class="contact-field">
      <label for="contact-email">Email</label>
      <input type="email" id="contact-email" name="email" autocomplete="email" required maxlength="190" />
    </div>
    <div class="contact-field">
      <label for="contact-message">Message</label>
      <textarea id="contact-message" name="message" required maxlength="5000" rows="7"></textarea>
    </div>
    <div class="contact-field hidden-field" aria-hidden="true">
      <label for="contact-company">Company</label>
      <input type="text" id="contact-company" name="company" tabindex="-1" autocomplete="off" />
    </div>
    <button type="submit" class="button contact-submit">Send Message</button>
  </form>
</div>`;

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

export type TechnologyGroup = {
  name: string;
  tags: string[];
};

let pagesCache: CollectionEntry<'pages'>[] | undefined;
let writeupsCache: Writeup[] | undefined;
let siteChromeCache: SiteChrome | undefined;
let technologyGroupsCache: TechnologyGroup[] | undefined;

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

function restoreFigures(html: string): string {
  return html.replace(
    /<p><img([^>]*)><\/p>\n<p>([^<][\s\S]*?)<\/p>/g,
    (match, imageAttrs: string, caption: string) => {
      const text = caption.replace(/<[^>]+>/g, '').trim();
      if (text.length > 180) return match;
      return `<figure><img${imageAttrs}><figcaption>${caption}</figcaption></figure>`;
    },
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

function renderTerminal(markdown: string): string {
  return markdown.replace(blockRe('terminal'), (_, content: string) => {
    const lines = content.replace(/\r?\n$/, '').split(/\r?\n/);
    const rendered = lines
      .map((line) => {
        if (line === '') return '';
        if (/^\$\s?/.test(line)) {
          const cmd = line.replace(/^\$\s?/, '');
          return `<span class="line"><span class="prompt">$</span> <span class="cmd">${md.utils.escapeHtml(cmd)}</span></span>`;
        }
        return `<span class="line out">${md.utils.escapeHtml(line)}</span>`;
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
    .replace(/::contact-form\s*::/g, contactFormHtml)
    .replace(blockRe('button sticky'), (_, button: string) => renderButton(button, 'sticky-button'))
    .replace(blockRe('button'), (_, button: string) => renderButton(button));

  return renderSplit(renderCenter(renderTerminal(withInlineDirectives)));
}

function renderWriteupMarkdown(markdown: string, slug: string): string {
  const html = md.render(renderTerminal(stripArticleChrome(markdown)));
  return restoreFigures(html)
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
  const pages = pagesCache ?? (pagesCache = await getCollection('pages', (page) => page.data.published));
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
  if (technologyGroupsCache) return technologyGroupsCache;

  const file = path.resolve(process.cwd(), 'src/content/technology-groups.md');
  const body = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const sections = body.split(/^##\s+/m).slice(1);

  technologyGroupsCache = sections
    .map((section) => {
      const [nameLine = '', ...lines] = section.split('\n');
      const tags = lines
        .map((line) => line.match(/^- (.+)$/)?.[1]?.trim())
        .filter((tag): tag is string => Boolean(tag));
      return { name: nameLine.trim(), tags };
    })
    .filter((group) => group.name && group.tags.length > 0);

  return technologyGroupsCache;
}

export async function getWriteups(): Promise<Writeup[]> {
  if (writeupsCache) return writeupsCache;

  const entries = await getCollection('writeups', (entry) => entry.data.published === true);

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
