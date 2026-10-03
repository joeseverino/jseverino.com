#!/usr/bin/env node
// Emit public/content-index.json, a machine-readable index of published
// writeups for Severino HQ to pull (gated by a Cloudflare Access service token).
// The data is already public. Sorted with stable keys so builds diff cleanly.
// The file is build output (gitignored); build-static writes it before astro build.
import fs from 'node:fs';
import path from 'node:path';
import { cli } from './lib/args.ts';
import { writeupUrl } from '../src/lib/site-config.ts';
import { snapshotWriteups } from '../src/lib/snapshot.ts';
import { siteRoot } from '../src/lib/site-root.ts';

const outFile = path.join(siteRoot, 'public/content-index.json');

cli({ usage: 'usage: node bin/make-content-index.ts' });

// public/content-index.json, as Severino HQ reads it.
export interface ContentIndexItem {
  slug: string;
  title: string;
  description: string;
  published_at: string | null;
  technologies: string[];
  url: string;
}

export interface ContentIndex {
  generator: 'make-content-index';
  count: number;
  items: ContentIndexItem[];
}

function buildIndex(): ContentIndex {
  const items: ContentIndexItem[] = [];
  for (const { slug, data } of snapshotWriteups()) {
    if (data.published !== true) continue; // published-only; drafts excluded

    const publishedAt =
      data.published_at instanceof Date
        ? data.published_at.toISOString()
        : data.published_at
          ? new Date(data.published_at as string).toISOString()
          : null;

    items.push({
      slug,
      // The committed snapshot passed the contract: both are strings when present.
      title: String(data.title ?? ''),
      description: String(data.description ?? '').trim(),
      published_at: publishedAt,
      technologies: Array.isArray(data.technologies)
        ? [...data.technologies].map(String).sort()
        : [],
      url: writeupUrl(slug),
    });
  }

  // Deterministic: newest first, slug as tiebreak.
  items.sort((a, b) => {
    const at = a.published_at ?? '';
    const bt = b.published_at ?? '';
    if (at !== bt) return bt.localeCompare(at);
    return a.slug.localeCompare(b.slug);
  });

  return { generator: 'make-content-index', count: items.length, items };
}

const index = buildIndex();
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(index, null, 2)}\n`);
console.log(`Wrote ${index.count} item(s) to public/content-index.json`);
