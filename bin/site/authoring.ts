// Vault-side commands: scaffold, validate, order the featured list, browse technologies.
import fs from 'node:fs';
import path from 'node:path';
import { checkContent } from '../content-sync/sync.ts';
import { WRITEUPS_FOLDER, vaultRoot } from '../lib/local-paths.ts';
import { listWriteups, reorderFeatured, technologyCatalog, writeupStore } from '../lib/writeups/store.ts';
import { parseFrontmatter } from '../../src/lib/frontmatter.ts';
import { writeupPath } from '../../src/lib/site-config.ts';
import { EXIT, SiteError, assertSlug, type Output } from './cli.ts';
import type { FeaturedEntry, FeaturedListing, FeaturedResult, NewResult, TechResult, ValidateResult } from './types.ts';
import { guard } from './writeups.ts';
import { isoDate } from '../../src/lib/dates.ts';

export async function newWriteup({ slug: requested, out }: { slug: string | undefined; out: Output }): Promise<NewResult> {
  const slug = assertSlug(requested);
  const vault = vaultRoot();
  const template = path.join(vault, '00 Templates', 'Writeup.md');
  const target = path.join(vault, WRITEUPS_FOLDER, slug);
  if (!fs.existsSync(template)) throw new SiteError(`writeup template not found: ${template}`, { fix: 'set VAULT_DIR to the vault root' });
  if (fs.existsSync(target)) throw new SiteError(`writeup already exists: ${target}`, { code: EXIT.usage, fix: `site validate ${slug} --draft` });

  const body = fs.readFileSync(template, 'utf8')
    .replaceAll('{{date:YYYY-MM-DD}}', isoDate())
    .replaceAll('{{title}}', slug);
  if (parseFrontmatter(body).data.published !== false) {
    throw new SiteError(`the template does not start writeups at published: false: ${template}`);
  }
  fs.mkdirSync(path.join(target, 'images'), { recursive: true });
  const file = path.join(target, 'index.md');
  fs.writeFileSync(file, body);
  out.ok('created', file);
  return {
    slug,
    path: file,
    url: writeupPath(slug),
    next: `fill the title, description, cover_alt and technologies; drop the cover in images/; then: site validate ${slug} --draft`,
  };
}

export async function validate({ slug, draft, out }: { slug: string | undefined; draft: boolean; out: Output }): Promise<ValidateResult> {
  if (slug) assertSlug(slug);
  const result = await checkContent({ vaultRoot: vaultRoot(), slug, draft });
  for (const doc of result.documents) {
    if (doc.issues.length === 0) continue;
    out.fail(doc.collection === 'pages' ? 'page' : 'writeup', doc.slug);
    for (const issue of doc.issues) out.text(`           - ${issue}`);
  }
  const failing = result.documents.filter((doc) => doc.issues.length > 0);
  const summary = { documents: result.documents, checked: result.documents.length, failing: failing.length };
  if (failing.length > 0) {
    throw new SiteError(`${failing.length} of ${result.documents.length} documents have issues`, {
      result: summary,
      fix: 'fix each listed issue in the vault, then rerun site validate',
    });
  }
  out.ok('validate', `${result.documents.length} ${slug ? 'writeup' : 'documents'} pass${draft ? ' (draft mode)' : ''}`);
  return { ...summary, next: slug && !draft ? 'site publish' : null };
}

const featuredOrder = (): FeaturedListing => {
  const listing = listWriteups(writeupStore(), 'featured');
  return {
    order: listing.featuredOrder.map(({ slot, slug, title }) => ({ slot: slot ?? 0, slug, title })),
    flaggedDrafts: listing.order.filter((entry) => !entry.published).map(({ slug, title }) => ({ slug, title })),
  };
};

// The 1-based slot a target names, 0 to unfeature.
function resolveSlot(order: readonly FeaturedEntry[], slug: string, target: string | undefined): number {
  const current = order.find((entry) => entry.slug === slug)?.slot ?? null;
  const n = order.length;
  const notFeatured = (): never => {
    throw new SiteError(`${slug} is not featured`, { code: EXIT.usage, fix: `insert it with a slot number, top, or bottom: site featured ${slug} top` });
  };
  switch (target) {
    case 'top': return 1;
    case 'bottom': return current === null ? n + 1 : n;
    case 'up': return current === null ? notFeatured() : Math.max(1, current - 1);
    case 'down': return current === null ? notFeatured() : Math.min(n, current + 1);
    case 'off': return 0;
    default:
      if (!/^\d+$/.test(target ?? '')) {
        throw new SiteError(`target must be a slot number, up, down, top, bottom, or off: '${target ?? ''}'`, { code: EXIT.usage });
      }
      return Math.max(1, Math.min(Number(target), current === null ? n + 1 : n));
  }
}

function printOrder({ order, flaggedDrafts }: FeaturedListing, out: Output): void {
  const width = Math.max(0, ...[...order, ...flaggedDrafts].map((entry) => entry.slug.length)) + 2;
  for (const entry of order) out.text(`  ${String(entry.slot).padStart(2)}  ${entry.slug.padEnd(width)}${entry.title}`);
  for (const entry of flaggedDrafts) out.text(`   -  ${entry.slug.padEnd(width)}(draft: flagged featured, not rendered)`);
  if (order.length === 0 && flaggedDrafts.length === 0) out.text('  no featured writeups');
}

export async function featured({ slug, target, out }: { slug: string | undefined; target: string | undefined; out: Output }): Promise<FeaturedResult> {
  if (!slug) {
    const listing = await guard(featuredOrder);
    printOrder(listing, out);
    return { ...listing, next: null };
  }
  assertSlug(slug);
  if (!target) throw new SiteError('a target is required', { code: EXIT.usage, fix: `site featured ${slug} <slot|up|down|top|bottom|off>` });
  const slot = resolveSlot((await guard(featuredOrder)).order, slug, target);
  await guard(() => reorderFeatured(writeupStore(), slug, slot));
  out.ok('moved', slot === 0 ? `${slug} unfeatured` : `${slug} to slot ${slot}`);
  const listing = await guard(featuredOrder);
  printOrder(listing, out);
  return { moved: { slug, slot }, ...listing, next: 'site publish' };
}

export async function tech({ query, out }: { query: string | undefined; out: Output }): Promise<TechResult> {
  const store = writeupStore();
  const catalog = await guard(() => technologyCatalog(store));
  const q = (query ?? '').toLowerCase();
  const groups = catalog.groups
    .map((group) => ({
      name: group.name,
      tags: group.tags.filter((tag) => !q || [tag.slug, tag.label, group.name].some((value) => value.toLowerCase().includes(q))),
    }))
    .filter((group) => group.tags.length > 0);
  if (groups.length === 0) throw new SiteError(`no catalog match for: ${query}`, { fix: `add a "| slug | Label | |" row to ${catalog.path}` });
  for (const group of groups) {
    out.text(group.name);
    for (const tag of group.tags) out.text(`  ${tag.slug.padEnd(36)}${tag.label}${tag.featured ? '  [featured]' : ''}`);
  }
  return { catalog: path.relative(store.vaultRoot, catalog.path), groups, next: null };
}
