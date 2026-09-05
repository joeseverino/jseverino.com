#!/usr/bin/env node
// Emit public/content-index.json — a machine-readable index of published
// writeups for Severino HQ to pull (gated by a Cloudflare Access service token).
// The data here is already public; the index just makes it consumable without
// scraping. Deterministic output (sorted, stable keys) so builds are diffable.
//
//   node bin/make-content-index.mjs           # write the index
//   node bin/make-content-index.mjs --check    # fail if the on-disk index is stale
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from '../src/lib/frontmatter.mjs';
import { siteRoot } from '../src/lib/site-root.mjs';

const writeupsDir = path.join(siteRoot, 'src/content/writeups');
const outFile = path.join(siteRoot, 'public/content-index.json');
const SITE_ORIGIN = 'https://jseverino.com';

const checkOnly = process.argv.includes('--check');

function buildIndex() {
  const entries = fs
    .readdirSync(writeupsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  const items = [];
  for (const dir of entries) {
    const slug = dir.name;
    const indexPath = path.join(writeupsDir, slug, 'index.md');
    if (!fs.existsSync(indexPath)) continue;
    const { data } = parseFrontmatter(fs.readFileSync(indexPath, 'utf8'));
    if (data.published !== true) continue; // published-only; drafts excluded

    const publishedAt =
      data.published_at instanceof Date
        ? data.published_at.toISOString()
        : data.published_at
          ? new Date(data.published_at).toISOString()
          : null;

    items.push({
      slug,
      title: data.title ?? '',
      description: (data.description ?? '').trim(),
      published_at: publishedAt,
      technologies: Array.isArray(data.technologies)
        ? [...data.technologies].map(String).sort()
        : [],
      url: `${SITE_ORIGIN}/portfolio/${slug}/`,
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

const payload = JSON.stringify(buildIndex(), null, 2) + '\n';

if (checkOnly) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (current !== payload) {
    console.error(
      'content-index.json is stale — run `npm run make:content-index` and commit.'
    );
    process.exit(1);
  }
  console.log('content-index.json is up to date.');
} else {
  await fsPromises.mkdir(path.dirname(outFile), { recursive: true });
  await fsPromises.writeFile(outFile, payload);
  const { count } = buildIndex();
  console.log(`Wrote ${count} item(s) to public/content-index.json`);
}
