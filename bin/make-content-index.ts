#!/usr/bin/env node
// Emit public/content-index.json for Severino HQ to pull (gated by a Cloudflare
// Access service token). Gitignored build output; sorted with stable keys.
import fs from 'node:fs';
import { cli } from './lib/args.ts';
import { writeupUrl } from '../src/lib/site-config.ts';
import { snapshotWriteups } from '../src/lib/snapshot.ts';
import { fromRoot } from '../src/lib/site-root.ts';

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
const isoDate = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null;

const items = snapshotWriteups()
  .filter(({ data }) => data.published === true)
  .map(({ slug, data }): ContentIndexItem => ({
    slug,
    title: String(data.title ?? ''),
    description: String(data.description ?? '').trim(),
    published_at: isoDate(data.published_at),
    technologies: Array.isArray(data.technologies) ? data.technologies.map(String).sort() : [],
    url: writeupUrl(slug),
  }))
  // Newest first, then by slug.
  .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? '') || a.slug.localeCompare(b.slug));

const outFile = fromRoot('public/content-index.json');
fs.mkdirSync(fromRoot('public'), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify({ generator: 'make-content-index', count: items.length, items }, null, 2)}\n`);
console.log(`Wrote ${items.length} item(s) to public/content-index.json`);
