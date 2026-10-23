#!/usr/bin/env node
import { writeJson } from '../src/lib/json.ts';
import { writeupUrl } from '../src/lib/site-config.ts';
import { fromRoot } from '../src/lib/site-root.ts';
import { snapshotWriteups } from '../src/lib/snapshot.ts';
// Emit public/content-index.json for Severino HQ to pull (gated by a Cloudflare
// Access service token). Gitignored build output; sorted with stable keys.
import { cli } from './lib/args.ts';

cli({ usage: 'usage: node bin/make-content-index.ts' });

interface ContentIndexItem {
  slug: string;
  title: string;
  description: string;
  published_at: string | null;
  technologies: string[];
  url: string;
}

// The frontmatter parser yields a Date for a bare YAML date and a string for a quoted one.
const isoDate = (value: unknown): string | null => (value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null);

const items = snapshotWriteups()
  .filter(({ data }) => data.published === true)
  .map(
    ({ slug, data }): ContentIndexItem => ({
      slug,
      title: String(data.title ?? ''),
      description: String(data.description ?? '').trim(),
      published_at: isoDate(data.published_at),
      technologies: Array.isArray(data.technologies) ? data.technologies.map(String).sort() : [],
      url: writeupUrl(slug),
    }),
  )
  // Newest first, then by slug.
  .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? '') || a.slug.localeCompare(b.slug));

writeJson(fromRoot('public/content-index.json'), { generator: 'make-content-index', count: items.length, items });
console.log(`Wrote ${items.length} item(s) to public/content-index.json`);
