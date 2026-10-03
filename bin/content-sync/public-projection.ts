import { projectFrontmatter } from '../../src/lib/content-contract.ts';
import type { FrontmatterData, ParsedFrontmatter } from '../../src/lib/frontmatter.ts';
import { normalizeLocalAssetRef } from './assets.ts';

// Frontmatter dates arrive as strings or, for YAML timestamps, Dates.
const time = (value: unknown): number => (value ? new Date(value as string | Date).getTime() : Number.NaN);
const later = (a: unknown, b: unknown): unknown => (!b || time(a) >= time(b) ? a || b : b);

// last_reviewed moves to today when the projected body differs from the
// committed snapshot's. An unchanged body keeps the later of the vault's date
// and the committed one, so a re-sync is idempotent and a bump never reverts.
export function reviewedDate(data: FrontmatterData, previous: ParsedFrontmatter | undefined, body: string, today: string): unknown {
  const authored = data.last_reviewed || data.published_at;
  if (!previous) return authored || today;
  if (previous.content !== body) return today;
  return later(authored, previous.data.last_reviewed) || today;
}

// previousWriteup(slug) returns the committed snapshot's { data, content } for
// a writeup, or undefined when it has none.
export interface ProjectionOptions {
  today: string;
  previousWriteup?: (slug: string) => ParsedFrontmatter | undefined;
}

export type PublicProjection = ReturnType<typeof createPublicProjection>;

export function createPublicProjection({ today, previousWriteup = () => undefined }: ProjectionOptions) {
  return {
    page(data: FrontmatterData): FrontmatterData { return projectFrontmatter('pages', data); },
    writeup(data: FrontmatterData, { slug, body }: { slug: string; body: string }): FrontmatterData {
      return projectFrontmatter('writeups', {
        ...data,
        cover_image: coverPath(data.cover_image),
        last_reviewed: reviewedDate(data, previousWriteup(slug), body, today),
      });
    },
  };
}

// cover_image as a path relative to the document, for Astro's image() schema.
function coverPath(value: unknown): unknown {
  const ref = normalizeLocalAssetRef(value);
  return ref ? `./${ref}` : value;
}

// A writeup page renders its title, lede, and cover from frontmatter, so the
// body's own H1, opening blockquote, and leading image are dropped.
export function stripArticleChrome(markdown: string): string {
  const body = markdown
    .trimStart()
    .replace(/^# .+(?:\r?\n)+/, '')
    .replace(/^>\s+.+(?:\r?\n)+/, '')
    .replace(/^!\[[^\]]*\]\([^)]+\)(?:\r?\n)+/, '')
    .trim();
  return `${body}\n`;
}

function stripHtmlTags(value: string): string {
  let current = value;
  let previous: string;
  do { previous = current; current = current.replace(/<[^>]+>/g, ''); } while (current !== previous);
  return current;
}

export function normalizeDescription(text: string): string {
  const withoutMarkdownLinks = text
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  return stripHtmlTags(withoutMarkdownLinks)
    .replace(/\\$/gm, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ').trim();
}

export function stripRepeatedDescription(markdown: string, description: unknown): string {
  if (typeof description !== 'string' || !description.trim()) return markdown;
  const expected = normalizeDescription(description);
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    const candidateStart =
      (trimmed.startsWith('>') || trimmed.startsWith('[') || /^[A-Z0-9]/.test(trimmed)) &&
      output.some((previous) => /^#\s+/.test(previous.trim()));
    if (!candidateStart) { output.push(line); index += 1; continue; }
    const start = index;
    const candidate: string[] = [];
    for (let line; (line = lines[index]) !== undefined && line.trim() !== ''; index += 1) candidate.push(line);
    const text = normalizeDescription(candidate.join(' ').replace(/^>\s?/gm, ''));
    if (text === expected) { while (lines[index]?.trim() === '') index += 1; continue; }
    output.push(...lines.slice(start, index));
  }
  return `${output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
