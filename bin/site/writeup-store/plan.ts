// Writes to writeup frontmatter: a reviewed plan of field updates and the complete featured order,
// a single reorder, or one writeup's fields, each applied in one transaction with a receipt.
import fs from 'node:fs';
import path from 'node:path';
import { collectionFields } from '../../../src/lib/content-contract.ts';
import { localDate } from '../../lib/dates.ts';
import { fingerprint, type MutationReceipt, receipt } from './receipt.ts';
import { applyScalars } from './scalar.ts';
import { byFeaturedOrder, featuredOrder, findWriteup, loadWriteups, summary, type Writeup, WriteupError, type WriteupStore } from './store.ts';
import { type Replacement, type TransactionOptions, transactionalReplace } from './transaction.ts';

// Write the replacements together or not at all; a failure rolls back and throws.
export function commit(replacements: ReadonlyMap<string, Replacement>, options?: TransactionOptions): void {
  const outcome = transactionalReplace(replacements, options);
  if (!outcome.ok) throw new WriteupError('transaction_failed', `writeup transaction failed: ${outcome.error}`, { rolled_back: outcome.rolledBack });
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
