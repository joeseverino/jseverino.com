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
