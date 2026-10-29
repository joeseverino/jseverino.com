// The vault's writeup inventory as typed operations. No console output or process state: every operation
// takes its paths in a WriteupStore, so the CLI, the manage TUI, and HQ share them.
import fs from 'node:fs';
import path from 'node:path';
import { collectionFields, contentContract, contentContractFingerprint } from '../../../src/lib/content-contract.ts';
import { isoDate, localDate } from '../../../src/lib/dates.ts';
import { parseFrontmatter } from '../../../src/lib/frontmatter.ts';
import { parseTechnologyGroups, type TechnologyGroup } from '../../../src/lib/technology-groups.ts';
import { type CheckedDocument, checkContent } from '../../content-sync/sync.ts';
import { DetailedError } from '../detailed-error.ts';
import { PAGES_FOLDER, vaultRoot, WRITEUPS_FOLDER } from '../local-paths.ts';
import { fingerprint, type MutationReceipt, receipt } from './receipt.ts';
import { applyScalars } from './scalar.ts';
import { type Replacement, type TransactionOptions, transactionalReplace } from './transaction.ts';

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

const summary = (writeup: Writeup): WriteupSummary => {
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

const entry = (writeup: Writeup, slot: number | null): OrderEntry => ({
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
    .map((w, index) => entry(w, index + 1));
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

export function listWriteups(store: WriteupStore, filter: WriteupFilter = 'all', writeups = loadWriteups(store)): WriteupListing {
  if (!WRITEUP_FILTERS.includes(filter)) throw new WriteupError('invalid', `unknown filter '${filter}'; expected one of ${WRITEUP_FILTERS.join(', ')}`);
  let selected = [...writeups];
  if (filter === 'published') selected = selected.filter((w) => w.published);
  if (filter === 'draft') selected = selected.filter((w) => !w.published);
  if (filter === 'featured') selected = selected.filter((w) => w.featured).toSorted(byFeaturedOrder);
  return {
    filter,
    count: selected.length,
    order: selected.map((w, index) => entry(w, index + 1)),
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

// The writeup with this slug, or a not_found error.
function findWriteup(writeups: readonly Writeup[], slug: string): Writeup {
  const writeup = writeups.find((candidate) => candidate.slug === slug);
  if (!writeup) throw new WriteupError('not_found', `writeup not found: ${slug}`);
  return writeup;
}

// Write the replacements together or not at all; a failure rolls back and throws.
function commit(replacements: ReadonlyMap<string, Replacement>, options?: TransactionOptions): void {
  const outcome = transactionalReplace(replacements, options);
  if (!outcome.ok) throw new WriteupError('transaction_failed', `writeup transaction failed: ${outcome.error}`, { rolled_back: outcome.rolledBack });
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

// Frontmatter fields a write may set: the contract's editable fields.
const EDITABLE_FIELDS: readonly string[] = Object.entries(collectionFields('writeups'))
  .filter(([, spec]) => spec.editable === true)
  .map(([name]) => name);

export interface WriteupPlan {
  updates?: ({ slug: string } & Record<string, unknown>)[];
  // The complete featured order; omitted leaves it unchanged.
  featured_order?: string[];
  source_fingerprint?: string;
}

export interface PlanResult {
  noOp: boolean;
  changedWriteups: string[];
  changedFields: Record<string, string[]>;
  featuredOrderAfter: string[];
  receipt?: MutationReceipt;
}

// A plan arrives as JSON, so its shape is checked before any field is read.
function assertPlanShape(plan: WriteupPlan): void {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new WriteupError('invalid', 'plan must be a JSON object');
  if (!Array.isArray(plan.updates ?? [])) throw new WriteupError('invalid', 'updates must be a list');
  if (plan.featured_order !== undefined && !Array.isArray(plan.featured_order)) throw new WriteupError('invalid', 'featured_order must be a list');
}

// A plan reviewed against an older dashboard is refused, so it never overwrites a change made since.
function assertFresh(writeups: Writeup[], expected: string | undefined): void {
  if (!expected) return;
  const current = fingerprint(writeups.map(summary));
  if (current !== expected) {
    throw new WriteupError('stale_plan', 'writeup source changed after this dashboard was loaded; reload and review the plan again', {
      expected_fingerprint: expected,
      current_fingerprint: current,
      retryable: true,
    });
  }
}

// Each writeup's fields to set, merged across the plan's updates for it.
function fieldUpdates(rawUpdates: NonNullable<WriteupPlan['updates']>, bySlug: Map<string, Writeup>): Map<string, Record<string, unknown>> {
  const updates = new Map<string, Record<string, unknown>>();
  for (const item of rawUpdates) {
    if (!item || typeof item !== 'object') throw new WriteupError('invalid', 'every update must be an object');
    const slug = String(item.slug ?? '').trim();
    if (!bySlug.has(slug)) throw new WriteupError('not_found', `unknown writeup slug: '${slug}'`);
    const unknown = Object.keys(item)
      .filter((key) => key !== 'slug' && !EDITABLE_FIELDS.includes(key))
      .sort();
    if (unknown.length) throw new WriteupError('invalid', `unsupported fields for ${slug}: ${unknown.join(', ')}`);
    const { slug: _slug, ...fields } = item;
    updates.set(slug, { ...updates.get(slug), ...fields });
  }
  return updates;
}

// The plan's featured order as slugs, refused when it repeats a slug or names an unknown one.
function checkedOrder(featuredOrder: string[], bySlug: Map<string, Writeup>): string[] {
  const order = featuredOrder.map(String);
  if (new Set(order).size !== order.length) throw new WriteupError('invalid', 'featured_order contains duplicate slugs');
  const unknown = order.filter((slug) => !bySlug.has(slug));
  if (unknown.length) throw new WriteupError('not_found', `featured_order contains unknown slugs: ${unknown.join(', ')}`);
  return order;
}

// The featured and featured_order values the complete order gives each writeup whose values differ.
function placements(order: readonly string[], writeups: readonly Writeup[]): Map<string, { featured: boolean; featured_order: number | null }> {
  const slots = new Map(order.map((slug, index) => [slug, index + 1]));
  const changes = new Map<string, { featured: boolean; featured_order: number | null }>();
  for (const w of writeups) {
    const featured = slots.has(w.slug);
    const slot = slots.get(w.slug) ?? null;
    if (w.featured !== featured || w.featured_order !== slot) changes.set(w.slug, { featured, featured_order: slot });
  }
  return changes;
}

// The new text of each writeup the updates change, and the fields that changed in it.
function replacementsFor(updates: Map<string, Record<string, unknown>>, bySlug: Map<string, Writeup>) {
  const replacements = new Map<string, Replacement>();
  const changedFields: Record<string, string[]> = {};
  for (const [slug, fields] of updates) {
    const writeup = bySlug.get(slug) as Writeup;
    const before = fs.readFileSync(writeup.path, 'utf8');
    const { text, changed } = applyScalars(before, fields);
    if (changed.length) {
      replacements.set(writeup.path, { before, after: text });
      changedFields[slug] = changed;
    }
  }
  return { replacements, changedFields };
}

// Scalar updates and the complete featured order in one transaction.
export function applyPlan(store: WriteupStore, plan: WriteupPlan, options: TransactionOptions = {}): PlanResult {
  assertPlanShape(plan);
  const writeups = loadWriteups(store);
  assertFresh(writeups, plan.source_fingerprint);
  const bySlug = new Map(writeups.map((w) => [w.slug, w]));
  const updates = fieldUpdates(plan.updates ?? [], bySlug);
  const order = plan.featured_order === undefined ? undefined : checkedOrder(plan.featured_order, bySlug);
  if (order) for (const [slug, placement] of placements(order, writeups)) updates.set(slug, { ...updates.get(slug), ...placement });
  const { replacements, changedFields } = replacementsFor(updates, bySlug);
  if (replacements.size === 0) {
    return { noOp: true, changedWriteups: [], changedFields: {}, featuredOrderAfter: order ?? featuredOrder(writeups).map((e) => e.slug) };
  }
  commit(replacements, options);

  const changedWriteups = Object.keys(changedFields).sort();
  const featuredOrderAfter = order ?? featuredOrder(loadWriteups(store)).map((e) => e.slug);
  return {
    noOp: false,
    changedWriteups,
    changedFields,
    featuredOrderAfter,
    receipt: receipt({
      operation: 'writeup.plan.apply',
      entityType: 'writeup_set',
      entityId: 'writeups',
      changedFields: Object.entries(changedFields).flatMap(([slug, fields]) => fields.map((field) => `${slug}.${field}`)),
      after: { changed: changedFields, featured_order: featuredOrderAfter },
      affectedProjections: ['featured_writeups', 'site', 'writeup_dashboard'],
      metadata: { changed_writeups: changedWriteups },
    }),
  };
}

export interface ReorderResult extends PlanResult {
  slug: string;
  position: number | null;
}

// Insert, move, or (position 0) unfeature one writeup; the set stays 1..N.
export function reorderFeatured(store: WriteupStore, slug: string, position: number, options: TransactionOptions = {}): ReorderResult {
  if (!Number.isInteger(position) || position < 0) throw new WriteupError('invalid', 'position must be an integer >= 0');
  const writeups = loadWriteups(store);
  findWriteup(writeups, slug);
  const others = writeups
    .filter((w) => w.featured)
    .toSorted(byFeaturedOrder)
    .map((w) => w.slug)
    .filter((s) => s !== slug);
  if (position > others.length + 1) throw new WriteupError('invalid', `position ${position} out of range (max ${others.length + 1})`);
  const order = position === 0 ? others : [...others.slice(0, position - 1), slug, ...others.slice(position - 1)];
  return { slug, position: position === 0 ? null : position, ...applyPlan(store, { featured_order: order }, options) };
}

export interface FrontmatterResult {
  slug: string;
  noOp: boolean;
  changedFields: string[];
  values: Record<string, unknown>;
  receipt?: MutationReceipt;
}

// Set editable frontmatter fields on one writeup. touchLastReviewed stamps today.
export function updateFrontmatter(
  store: WriteupStore,
  slug: string,
  fields: Record<string, unknown>,
  { touchLastReviewed = false, today = localDate() }: { touchLastReviewed?: boolean; today?: string } = {},
): FrontmatterResult {
  const unknown = Object.keys(fields)
    .filter((key) => !EDITABLE_FIELDS.includes(key))
    .sort();
  if (unknown.length) throw new WriteupError('invalid', `unsupported fields: ${unknown.join(', ')}; editable: ${EDITABLE_FIELDS.join(', ')}`);
  const updates = Object.fromEntries(
    Object.entries({ ...fields, ...(touchLastReviewed ? { last_reviewed: today } : {}) }).filter(([, value]) => value !== undefined),
  );
  const writeup = findWriteup(loadWriteups(store), slug);
  const source = fs.readFileSync(writeup.path, 'utf8');
  const { text, changed } = applyScalars(source, updates);
  if (changed.length === 0) return { slug, noOp: true, changedFields: [], values: {} };
  commit(new Map([[writeup.path, { before: source, after: text }]]));
  const before = summary(writeup);
  const values = Object.fromEntries(changed.map((key) => [key, updates[key] ?? null]));
  return {
    slug,
    noOp: false,
    changedFields: changed,
    values,
    receipt: receipt({
      operation: 'writeup.update',
      entityType: 'writeup',
      entityId: slug,
      changedFields: changed,
      before,
      after: { ...before, ...updates },
      affectedProjections: ['featured_writeups', 'site', 'writeup_dashboard'],
      metadata: { relative_path: path.relative(store.vaultRoot, writeup.path) },
    }),
  };
}

export interface LinkResult {
  slug: string;
  label: string;
  oldHref: string;
  newHref: string;
  receipt: MutationReceipt;
}

const isHttpUrl = (href: string): boolean => {
  try {
    const url = new URL(href);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host !== '';
  } catch {
    return false;
  }
};

// Replace exactly one `[label](href)` in a writeup body; not a general editor.
export function updateLink(store: WriteupStore, slug: string, label: string, expectedHref: string, replacementHref: string): LinkResult {
  const writeup = findWriteup(loadWriteups(store), slug);
  if (!label.trim()) throw new WriteupError('invalid', 'link label required');
  for (const [name, href] of [
    ['expected', expectedHref],
    ['replacement', replacementHref],
  ] as const) {
    if (!isHttpUrl(href)) throw new WriteupError('invalid', `${name} href must be an absolute HTTP(S) URL`);
  }
  const text = fs.readFileSync(writeup.path, 'utf8');
  const pattern = new RegExp(`\\[${RegExp.escape(label)}\\]\\(${RegExp.escape(expectedHref)}(\\s+"[^"]*")?\\)`, 'g');
  const matches = text.match(pattern) ?? [];
  if (matches.length !== 1) throw new WriteupError('invalid', `expected exactly one matching link; found ${matches.length}`);
  const next = text.replace(pattern, (_match, title: string | undefined) => `[${label}](${replacementHref}${title ?? ''})`);
  commit(new Map([[writeup.path, { before: text, after: next }]]));
  return {
    slug,
    label,
    oldHref: expectedHref,
    newHref: replacementHref,
    receipt: receipt({
      operation: 'writeup.link.update',
      entityType: 'writeup',
      entityId: slug,
      changedFields: ['body.link'],
      after: { slug, href: replacementHref },
      affectedProjections: ['site', 'writeup_dashboard'],
      metadata: { label },
    }),
  };
}

// The site-owned writeup contract an editor or client builds from.
export const writeupContract = () => ({
  source: 'jseverino.com/contracts/content.v1.json',
  fingerprint: contentContractFingerprint(),
  contract: contentContract,
});
