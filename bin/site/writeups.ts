// `site` commands over the writeup store (bin/lib/writeups/store.ts): the CLI
// formats; the store reads and writes.
import fs from 'node:fs';
import {
  WRITEUP_FILTERS, WriteupError, applyPlan, dashboard, listWriteups, prepare, tagUsage, updateFrontmatter, updateLink,
  writeupContract, writeupStore, type WriteupFilter, type WriteupPlan,
} from '../lib/writeups/store.ts';
import { EXIT, SiteError, assertSlug, translate, type Output } from './cli.ts';
import type {
  ApplyPlanResult, ContractResult, DashboardResult, LinkCommandResult, PrepareResult, SetResult, TagResult, WriteupsResult,
} from './types.ts';
import { errorMessage } from '../../src/lib/error-message.ts';

// Store failures as CLI failures: a usage problem exits 2, the rest 1.
export const guard = <T>(work: () => T | Promise<T>): Promise<T> => translate(work, WriteupError, (error) => new SiteError(error.message, {
  code: error.code === 'invalid' ? EXIT.usage : EXIT.failed,
  result: { reason: error.code, ...error.details },
  fix: error.code === 'stale_plan' ? 'reload the dashboard and rebuild the plan' : undefined,
}));

export async function writeups({ filter, out }: { filter: string; out: Output }): Promise<WriteupsResult> {
  if (!(WRITEUP_FILTERS as readonly string[]).includes(filter)) {
    throw new SiteError(`--filter must be one of ${WRITEUP_FILTERS.join(', ')}`, { code: EXIT.usage });
  }
  const listing = await guard(() => listWriteups(writeupStore(), filter as WriteupFilter));
  const width = Math.max(0, ...listing.order.map((entry) => entry.slug.length)) + 2;
  for (const entry of listing.order) {
    const state = [entry.published ? 'published' : 'draft', entry.featured ? 'featured' : ''].filter(Boolean).join(', ');
    out.text(`  ${entry.slug.padEnd(width)}${state}`);
  }
  if (listing.count === 0) out.text('  no writeups');
  return { ...listing, next: null };
}

export async function showDashboard({ out }: { out: Output }): Promise<DashboardResult> {
  const result = await guard(() => dashboard(writeupStore(), { gate: true }));
  const failing = (result.gate ?? []).filter((doc) => doc.collection === 'writeups' && doc.issues.length > 0);
  out.ok('dashboard', `${result.writeups.length} writeups, ${result.featuredOrder.length} featured, ${failing.length} with gate issues`);
  for (const doc of failing) out.warn('issues', `${doc.slug}: ${doc.issues.length}`);
  return { ...result, next: null };
}

export async function tag({ slug, out }: { slug: string; out: Output }): Promise<TagResult> {
  const usage = await guard(() => tagUsage(writeupStore(), slug));
  out.text(`${usage.slug}: ${usage.totalMatches} writeups, ${usage.publishedMatches} published`);
  for (const w of usage.writeups) out.text(`  ${w.slug}${w.published ? '' : ' (draft)'}`);
  return { ...usage, next: null };
}

export async function prepareWriteup({ slug, tagUsage: withTags, out }: { slug: string; tagUsage: boolean; out: Output }): Promise<PrepareResult> {
  assertSlug(slug);
  const readiness = await guard(() => prepare(writeupStore(), slug, { includeTagUsage: withTags }));
  for (const issue of readiness.validation.issues) out.text(`  - ${issue}`);
  const place = readiness.featuredSet.position === null ? 'not featured' : `featured slot ${readiness.featuredSet.position}`;
  if (!readiness.ok) {
    throw new SiteError(`${slug} is not ready: ${readiness.validation.issues.length} gate issues`, {
      result: readiness, fix: 'fix each listed issue in the vault, then rerun site prepare',
    });
  }
  out.ok('ready', `${slug} passes the gate (${place})`);
  return { ...readiness, next: 'site publish' };
}

function readPlan(file: string | undefined): WriteupPlan {
  const text = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  try {
    return JSON.parse(text) as WriteupPlan;
  } catch (error) {
    throw new SiteError(`plan is not JSON: ${errorMessage(error)}`, { code: EXIT.usage });
  }
}

export async function applyWriteupPlan({ file, out }: { file: string | undefined; out: Output }): Promise<ApplyPlanResult> {
  const plan = readPlan(file);
  const result = await guard(() => applyPlan(writeupStore(), plan));
  if (result.noOp) out.ok('no change', 'nothing written');
  for (const slug of result.changedWriteups) out.ok('updated', `${slug}: ${result.changedFields[slug]?.join(', ')}`);
  return { ...result, next: result.noOp ? null : 'site publish' };
}

export async function set({
  slug, fields, touchLastReviewed, out,
}: { slug: string; fields: Record<string, unknown>; touchLastReviewed: boolean; out: Output }): Promise<SetResult> {
  assertSlug(slug);
  if (Object.keys(fields).length === 0 && !touchLastReviewed) {
    throw new SiteError('nothing to set', { code: EXIT.usage, fix: 'site set --help lists the editable fields' });
  }
  const result = await guard(() => updateFrontmatter(writeupStore(), slug, fields, { touchLastReviewed }));
  if (result.noOp) out.ok('no change', `${slug}: every field already has that value`);
  else out.ok('updated', `${slug}: ${result.changedFields.join(', ')}`);
  return { ...result, next: result.noOp ? null : `site validate ${slug} --draft` };
}

export async function link({
  slug, label, from, to, out,
}: { slug: string; label: string | undefined; from: string | undefined; to: string | undefined; out: Output }): Promise<LinkCommandResult> {
  assertSlug(slug);
  if (!label || !from || !to) throw new SiteError('--label, --from, and --to are required', { code: EXIT.usage, fix: 'site link --help' });
  const result = await guard(() => updateLink(writeupStore(), slug, label, from, to));
  out.ok('relinked', `${slug}: [${label}] ${from} -> ${to}`);
  return { ...result, next: `site validate ${slug}` };
}

export async function contract({ out }: { out: Output }): Promise<ContractResult> {
  const result = writeupContract();
  out.text(`${result.source} ${result.fingerprint.slice(0, 12)}`);
  for (const [name, spec] of Object.entries(result.contract.collections.writeups?.fields ?? {})) {
    out.text(`  ${name.padEnd(18)}${spec.type}${spec.editable ? ', editable' : ''}${spec.cli_flag ? ` (${spec.cli_flag})` : ''}`);
  }
  return { ...result, next: null };
}
