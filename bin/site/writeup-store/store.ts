// The vault's writeup inventory: the reads every writeup operation starts from. No console output
// or process state: every operation takes its paths in a WriteupStore, so the CLI, the manage TUI,
// and HQ share them. plan.ts and link.ts hold the writes.
import fs from 'node:fs';
import path from 'node:path';
import { contentContract, contentContractFingerprint } from '../../../src/lib/content-contract.ts';
import { isoDate } from '../../../src/lib/dates.ts';
import { parseFrontmatter } from '../../../src/lib/frontmatter.ts';
import { parseTechnologyGroups, type TechnologyGroup } from '../../../src/lib/technology-groups.ts';
import { type CheckedDocument, checkContent } from '../../content-sync/sync.ts';
import { DetailedError } from '../../lib/detailed-error.ts';
import { PAGES_FOLDER, vaultRoot, WRITEUPS_FOLDER } from '../../lib/local-paths.ts';
import { fingerprint } from './receipt.ts';

export interface WriteupStore {
  vaultRoot: string;
  writeupsDir: string;
  catalogPath: string;
}

export function writeupStore(env: NodeJS.ProcessEnv = process.env): WriteupStore {
  const root = vaultRoot(env);
  return {
    vaultRoot: root,
    writeupsDir: path.join(root, WRITEUPS_FOLDER),
    catalogPath: path.join(root, PAGES_FOLDER, '_technology-groups.md'),
  };
}

export type WriteupErrorCode = 'not_found' | 'invalid' | 'stale_plan' | 'transaction_failed';

export class WriteupError extends DetailedError {
  code: WriteupErrorCode;

  constructor(code: WriteupErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.code = code;
  }
}

export interface WriteupSummary {
  slug: string;
  title: string;
  description: string;
  published: boolean;
  published_at: string | null;
  last_reviewed: string | null;
  cover_image: string | null;
  cover_alt: string | null;
  featured: boolean;
  featured_order: number | null;
  technologies: string[];
  related_projects: string[];
  related_assets: string[];
}

export interface Writeup extends WriteupSummary {
  path: string;
  body: string;
}

export interface OrderEntry {
  slot: number | null;
  slug: string;
  title: string;
  published: boolean;
  featured: boolean;
}

// A frontmatter scalar as text, or null when absent or empty. YAML reads an
// unquoted date as a Date.
export const optionalString = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  return value instanceof Date ? isoDate(value) : String(value);
};

const optionalInt = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
};

const stringList = (value: unknown): string[] => {
  if (value === null || value === undefined || value === '') return [];
  return (Array.isArray(value) ? value : [value]).filter((item) => item !== null && item !== '').map(String);
};

export const summary = (writeup: Writeup): WriteupSummary => {
  const { path: _path, body: _body, ...rest } = writeup;
  return { ...rest, technologies: [...rest.technologies], related_projects: [...rest.related_projects], related_assets: [...rest.related_assets] };
};

function requireDir(dir: string): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new WriteupError('not_found', `writeups dir not found: ${dir}`);
}

// Every `<writeups>/<slug>/index.md` with frontmatter, sorted by slug.
export function loadWriteups(store: WriteupStore): Writeup[] {
  requireDir(store.writeupsDir);
  const writeups: Writeup[] = [];
  for (const entry of fs.readdirSync(store.writeupsDir, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const file = path.join(store.writeupsDir, entry.name, 'index.md');
    if (!fs.existsSync(file)) continue;
    const { data, content } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    if (Object.keys(data).length === 0) continue;
    writeups.push({
      slug: entry.name,
      title: String(data.title || entry.name),
      description: String(data.description || ''),
      published: data.published === true,
      published_at: optionalString(data.published_at),
      last_reviewed: optionalString(data.last_reviewed),
      cover_image: optionalString(data.cover_image),
      cover_alt: optionalString(data.cover_alt),
      featured: data.featured === true,
      featured_order: optionalInt(data.featured_order),
      technologies: stringList(data.technologies),
      related_projects: stringList(data.related_projects),
      related_assets: stringList(data.related_assets),
      path: file,
      body: content,
    });
  }
  return writeups;
}

// Featured order first, unordered last, then by slug.
export const byFeaturedOrder = (a: WriteupSummary, b: WriteupSummary): number =>
  (a.featured_order ?? 1e9) - (b.featured_order ?? 1e9) || a.slug.localeCompare(b.slug);

const orderEntry = (writeup: Writeup, slot: number | null): OrderEntry => ({
  slot,
  slug: writeup.slug,
  title: writeup.title,
  published: writeup.published,
  featured: writeup.featured,
});

// What the home page renders: published and featured, slotted 1..N.
export function featuredOrder(writeups: readonly Writeup[]): OrderEntry[] {
  return writeups
    .filter((w) => w.published && w.featured)
    .toSorted(byFeaturedOrder)
    .map((w, index) => orderEntry(w, index + 1));
}

export const WRITEUP_FILTERS = ['all', 'published', 'draft', 'featured'] as const;
export type WriteupFilter = (typeof WRITEUP_FILTERS)[number];

export interface WriteupListing {
  filter: WriteupFilter;
  count: number;
  order: OrderEntry[];
  featuredOrder: OrderEntry[];
  writeups: WriteupSummary[];
}

export function listWriteups(store: WriteupStore, filter: WriteupFilter = 'all'): WriteupListing {
  if (!WRITEUP_FILTERS.includes(filter)) throw new WriteupError('invalid', `unknown filter '${filter}'; expected one of ${WRITEUP_FILTERS.join(', ')}`);
  const writeups = loadWriteups(store);
  let selected = writeups;
  if (filter === 'published') selected = selected.filter((w) => w.published);
  if (filter === 'draft') selected = selected.filter((w) => !w.published);
  if (filter === 'featured') selected = selected.filter((w) => w.featured).toSorted(byFeaturedOrder);
  return {
    filter,
    count: selected.length,
    order: selected.map((w, index) => orderEntry(w, index + 1)),
    featuredOrder: featuredOrder(writeups),
    writeups: selected.map(summary),
  };
}

export interface TechnologyCatalog {
  path: string;
  totalSlugs: number;
  featuredCount: number;
  groups: TechnologyGroup[];
}

export function technologyCatalog(store: WriteupStore): TechnologyCatalog {
  if (!fs.existsSync(store.catalogPath)) throw new WriteupError('not_found', `technology catalog not found: ${store.catalogPath}`);
  const groups = parseTechnologyGroups(fs.readFileSync(store.catalogPath, 'utf8'));
  const tags = groups.flatMap((group) => group.tags);
  if (tags.length === 0) throw new WriteupError('invalid', `no technology slugs parsed from ${store.catalogPath}`);
  return { path: store.catalogPath, totalSlugs: tags.length, featuredCount: tags.filter((tag) => tag.featured).length, groups };
}

export interface TagUsage {
  slug: string;
  totalMatches: number;
  publishedMatches: number;
  writeups: { slug: string; title: string; published: boolean; featured: boolean }[];
}

export function tagUsage(store: WriteupStore, slug: string, writeups = loadWriteups(store)): TagUsage {
  const tag = slug.trim();
  if (!tag) throw new WriteupError('invalid', 'a technology slug is required');
  const matches = writeups.filter((w) => w.technologies.includes(tag));
  return {
    slug: tag,
    totalMatches: matches.length,
    publishedMatches: matches.filter((w) => w.published).length,
    writeups: matches.map(({ slug: s, title, published, featured }) => ({ slug: s, title, published, featured })),
  };
}

export interface WriteupDashboard {
  writeups: WriteupSummary[];
  featuredOrder: OrderEntry[];
  sourceFingerprint: string;
  // The draft-mode gate per document, when requested.
  gate?: CheckedDocument[];
}

// Every writeup and the featured order from one read, plus the fingerprint a
// later applyPlan uses to refuse a plan built on stale state.
export function snapshot(store: WriteupStore): WriteupDashboard {
  const listing = listWriteups(store, 'all');
  return { writeups: listing.writeups, featuredOrder: listing.featuredOrder, sourceFingerprint: fingerprint(listing.writeups) };
}

// The snapshot plus the draft-mode gate for every document.
export async function dashboard(store: WriteupStore, { gate = false }: { gate?: boolean } = {}): Promise<WriteupDashboard> {
  const result = snapshot(store);
  if (gate) result.gate = (await checkContent({ vaultRoot: store.vaultRoot, draft: true })).documents;
  return result;
}

export interface PublishReadiness {
  slug: string;
  ok: boolean;
  validation: CheckedDocument;
  featuredSet: { count: number; order: { slot: number | null; slug: string }[]; position: number | null };
  tagUsage?: Record<string, { totalWriteups: number; publishedWriteups: number }>;
}

export function findWriteup(writeups: readonly Writeup[], slug: string): Writeup {
  const writeup = writeups.find((candidate) => candidate.slug === slug);
  if (!writeup) throw new WriteupError('not_found', `writeup not found: ${slug}`);
  return writeup;
}

// The ship gate for one writeup with its place in the featured set.
export async function prepare(store: WriteupStore, slug: string, { includeTagUsage = false } = {}): Promise<PublishReadiness> {
  const writeups = loadWriteups(store);
  const writeup = findWriteup(writeups, slug);
  const [validation] = (await checkContent({ vaultRoot: store.vaultRoot, slug })).documents;
  const featured = writeups.filter((w) => w.featured).toSorted(byFeaturedOrder);
  const result: PublishReadiness = {
    slug,
    ok: Boolean(validation && validation.issues.length === 0),
    validation: validation ?? { collection: 'writeups', slug, published: writeup.published, issues: ['no gate result'] },
    featuredSet: {
      count: featured.length,
      order: featured.map((w) => ({ slot: w.featured_order, slug: w.slug })),
      position: featured.find((w) => w.slug === slug)?.featured_order ?? null,
    },
  };
  if (includeTagUsage) {
    result.tagUsage = Object.fromEntries(
      writeup.technologies.map((tag) => {
        const usage = tagUsage(store, tag, writeups);
        return [tag, { totalWriteups: usage.totalMatches, publishedWriteups: usage.publishedMatches }];
      }),
    );
  }
  return result;
}

// The site-owned writeup contract an editor or client builds from.
export const writeupContract = () => ({
  source: 'jseverino.com/contracts/content.v1.json',
  fingerprint: contentContractFingerprint(),
  contract: contentContract,
});
