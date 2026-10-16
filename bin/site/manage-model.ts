// site manage's state: writeup rows, staged edits, and Site tab status. Nothing here draws or reads keys.
import { statSync } from 'node:fs';
import path from 'node:path';
import { GREEN, RED, RESET, YELLOW } from './tui.ts';
import { DEV_PORT, isListening } from './dev-server.ts';
import { WRITEUPS_FOLDER, vaultRoot } from '../lib/local-paths.ts';
import { spawnResult } from '../lib/run.ts';
import { WriteupError, snapshot, writeupStore, type WriteupDashboard, type WriteupSummary } from '../lib/writeups/store.ts';
import { resolveBuiltDir } from '../../src/lib/build-output.ts';
import { SITE_ORIGIN } from '../../src/lib/site-config.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { SLUG, SiteError, createOutput } from './cli.ts';
import { checkContent } from '../content-sync/sync.ts';
import { newWriteup } from './authoring.ts';
import { collectionFields, type FieldSpec, type FieldType } from '../../src/lib/content-contract.ts';
import { errorMessage } from '../../src/lib/error-message.ts';
import { fingerprint } from '../lib/writeups/receipt.ts';

export const SITE = [process.execPath, path.join(siteRoot, 'bin/site.ts')] as const;

// The writeup snapshot, or a load failure the TUI shows instead of crashing.
function loadSnapshot(): WriteupDashboard {
  try {
    return snapshot(writeupStore());
  } catch (error) {
    if (error instanceof WriteupError) fail(`could not load the writeups: ${error.message}`);
    throw error;
  }
}

// The gate issues `site validate --draft` reports, per writeup slug. error
// names why there is no report, so a broken check never reads as "no issues".
async function gateIssues(slug?: string): Promise<{ issues: Map<string, string[]>; error: string | null }> {
  const issues = new Map<string, string[]>();
  try {
    const report = await checkContent({ vaultRoot: vaultRoot(), slug, draft: true });
    for (const doc of report.documents) if (doc.collection === 'writeups') issues.set(doc.slug, doc.issues);
    return { issues, error: null };
  } catch (error) {
    return { issues, error: `the gate check failed (${errorMessage(error)})` };
  }
}

function fail(message: string): never {
  throw new SiteError(message, { fix: 'check that the vault is reachable (VAULT_DIR)' });
}

function camelKey(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export interface Field {
  key: string;
  label: string;
  flag: string | undefined;
  editable: boolean;
  note: string | undefined;
  type: FieldType;
  default: unknown;
}

// One writeup row: its contract fields under camelCase keys, plus staged edits.
export interface Item {
  slug: string;
  edits: Record<string, string>;
  title: unknown;
  published: boolean;
  featured: boolean;
  [field: string]: unknown;
}

type Mode = 'list' | 'move' | 'detail' | 'edit' | 'new' | 'confirm-quit' | 'confirm-reload';
export type Tab = 'writeups' | 'site';

export interface SiteStatus {
  devServerOpen: boolean;
  gitBranch: string;
  gitChanges: number;
  gitAheadBehind: string;
  commitHash: string;
  commitSubject: string;
  commitAge: string;
  distStatus: string;
  securityStatus: string;
  liveCode: string;
  loadedAt: string;
}

export interface Model {
  items: Item[];
  divider: number;
  cursor: number;
  tab: Tab;
  mode: Mode;
  field: number;
  input: string;
  inputCursor: number;
  flash: string;
  created: string[];
  issues: Map<string, string[]>;
  origFeatured: string[];
  origPublished: Map<string, boolean>;
  siteStatus: SiteStatus | null;
  actionCursor: number;
  sourceFingerprint: string;
}

export const FIELDS: readonly Field[] = Object.entries(collectionFields('writeups'))
  .filter(([name, spec]) =>
    name !== 'doc_id' && !['publish-state', 'featured-order'].includes(spec.ownership ?? ''))
  .map(([name, spec]): Field => ({
    key: camelKey(name),
    label: name,
    flag: spec.cli_flag,
    editable: spec.editable === true,
    note: spec.editable === true ? undefined : 'edit in Obsidian',
    type: spec.type,
    default: spec.default,
  }));

function toItem(w: Partial<WriteupSummary> & { slug: string }, contractFields: Record<string, FieldSpec>): Item {
  const source: Record<string, unknown> = w;
  const fields: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(contractFields)) {
    const fallback = 'default' in spec ? structuredClone(spec.default) : '';
    fields[camelKey(name)] = source[name] ?? fallback;
  }
  return {
    slug: w.slug,
    edits: {},
    ...fields,
    title: fields.title || w.slug,
    published: !!fields.published,
    featured: !!fields.featured,
  };
}

// Trimmed stdout of a command, or null when it fails.
function probe(command: string, args: string[]): string | null {
  const result = spawnResult(command, args, { cwd: siteRoot });
  return result.code === 0 ? result.stdout.trim() : null;
}

function builtStatus(distPath: string): string {
  try {
    return `Present (built ${statSync(distPath).mtime.toISOString().slice(0, 16).replace('T', ' ')})`;
  } catch {
    return 'Present';
  }
}

export function loadSiteStatus(): SiteStatus {
  const branch = probe('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const changes = branch === null ? null : probe('git', ['status', '--porcelain']);
  const [commitHash = '', commitSubject = '', commitAge = ''] = (probe('git', ['log', '-1', '--format=%h%x09%s%x09%cr']) ?? '').split('\t');
  const counts = probe('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  const [ahead, behind, ...extra] = (counts ?? '').split(/\s+/);
  const security = probe(process.execPath, ['tests/audits/check-security-txt.ts']);
  const distPath = resolveBuiltDir(siteRoot);

  return {
    devServerOpen: isListening(DEV_PORT),
    gitBranch: branch ?? 'unknown',
    gitChanges: changes ? changes.split('\n').length : 0,
    gitAheadBehind: counts === null ? 'no upstream' : ahead && behind && extra.length === 0 ? `${ahead} ahead, ${behind} behind` : '',
    commitHash,
    commitSubject,
    commitAge,
    distStatus: distPath ? builtStatus(distPath) : 'not built',
    securityStatus: security === null ? 'signature invalid or missing' : (security.split('\n').at(-1) ?? '').replace(/^ok\s+/, '').trim(),
    liveCode: probe('curl', ['-s', '-o', '/dev/null', '-m', '2', '-w', '%{http_code}', SITE_ORIGIN]) ?? '',
    loadedAt: new Date().toTimeString().slice(0, 8),
  };
}

export async function load(): Promise<Model> {
  const loaded = loadSnapshot();
  const contractFields = collectionFields('writeups');
  const summaries = loaded.writeups;
  const featured = summaries
    .filter((w) => w.featured)
    .sort(
      (a, b) =>
        (a.featured_order ?? 1e9) - (b.featured_order ?? 1e9) || a.slug.localeCompare(b.slug),
    );
  const rest = summaries
    .filter((w) => !w.featured)
    .sort((a, b) => Number(b.published) - Number(a.published) || a.slug.localeCompare(b.slug));
  const items = [...featured, ...rest].map((writeup) => toItem(writeup, contractFields));

  const gate = await gateIssues();

  return {
    items,
    divider: featured.length,
    cursor: 0,
    tab: 'writeups',
    mode: 'list',
    field: 0,
    input: '',
    inputCursor: 0,
    flash: gate.error ? `${RED}gate issues unavailable: ${gate.error}${RESET}` : '',
    created: [],
    issues: gate.issues,
    origFeatured: featured.map((w) => w.slug),
    origPublished: new Map(items.map((i) => [i.slug, i.published])),
    siteStatus: null,
    actionCursor: 0,
    sourceFingerprint: loaded.sourceFingerprint,
  };
}

export async function reload(model: Model): Promise<void> {
  const oldCursor = model.cursor;
  const oldMode = model.mode;
  const oldTab = model.tab;
  const oldActionCursor = model.actionCursor;
  const next = await load();
  Object.assign(model, next);
  model.cursor = Math.min(model.items.length, oldCursor);
  model.mode = oldMode === 'confirm-reload' ? 'list' : oldMode;
  model.tab = oldTab;
  model.actionCursor = oldActionCursor;
  if (oldTab === 'site') model.siteStatus = loadSiteStatus();
  model.flash = next.flash || `${GREEN}reloaded writeups and validation status from disk${RESET}`;
}

export function fieldValue(item: Item, field: Field): unknown {
  if (field.key in item.edits) return item.edits[field.key];
  if (field.type === 'string[]') {
    // The contract types this field string[].
    return ((item[field.key] || []) as string[]).join(', ');
  }
  return item[field.key];
}

export function diff(model: Model) {
  const desired = model.items.slice(0, model.divider).map((i) => i.slug);
  const featuredChanged = JSON.stringify(desired) !== JSON.stringify(model.origFeatured);
  const publishFlips = model.items.filter((i) => i.published !== model.origPublished.get(i.slug));
  const fieldEdits = model.items.filter((i) => Object.keys(i.edits).length > 0);
  return { desired, featuredChanged, publishFlips, fieldEdits };
}

export function hasStaged(model: Model): boolean {
  const d = diff(model);
  return d.featuredChanged || d.publishFlips.length > 0 || d.fieldEdits.length > 0;
}

// Mutations: each changes the model only; the caller redraws.

export function moveCursor(model: Model, delta: number): void {
  // items.length is the trailing "new writeup…" row.
  model.cursor = Math.min(model.items.length, Math.max(0, model.cursor + delta));
}

// Indices the caller has already bounds-checked.
function swap(items: Item[], a: number, b: number): void {
  const first = items[a];
  const second = items[b];
  if (!first || !second) return;
  items[a] = second;
  items[b] = first;
}

export function moveItem(model: Model, delta: number): void {
  const i = model.cursor;
  if (i >= model.items.length) return;
  if (delta < 0) {
    if (i === 0) return;
    if (i === model.divider) {
      model.divider += 1; // first unfeatured crosses the line: becomes last featured
      return;
    }
    swap(model.items, i - 1, i);
    model.cursor = i - 1;
  } else {
    if (i === model.items.length - 1) return;
    if (i === model.divider - 1) {
      model.divider -= 1; // last featured crosses the line: becomes first unfeatured
      return;
    }
    swap(model.items, i + 1, i);
    model.cursor = i + 1;
  }
}

export function toggleFeatured(model: Model): void {
  const i = model.cursor;
  const item = model.items[i];
  if (!item) return;
  if (i < model.divider) {
    model.items.splice(i, 1);
    model.divider -= 1;
    model.items.splice(model.divider, 0, item);
    model.cursor = model.divider;
  } else {
    model.items.splice(i, 1);
    model.items.splice(model.divider, 0, item);
    model.cursor = model.divider;
    model.divider += 1;
  }
}

export function togglePublished(model: Model): void {
  const item = model.items[model.cursor];
  if (item) item.published = !item.published;
}

export async function createWriteup(model: Model, slug: string): Promise<boolean> {
  if (!SLUG.test(slug)) {
    model.flash = `${RED}slug must be lowercase-kebab-case: '${slug}'${RESET}`;
    return false;
  }
  if (model.items.some((i) => i.slug === slug)) {
    model.flash = `${RED}writeup already exists: ${slug}${RESET}`;
    return false;
  }
  try {
    await newWriteup({ slug, out: createOutput({ quiet: true }) });
  } catch (error) {
    model.flash = `${RED}site new failed: ${errorMessage(error)}${RESET}`;
    return false;
  }
  // Pull the scaffold's real frontmatter so the detail view edits the truth.
  let summary: WriteupSummary | undefined;
  try {
    const next = snapshot(writeupStore());
    summary = next.writeups.find((w) => w.slug === slug);
    // Accept this scaffold without accepting unrelated edits since the model loaded.
    if (summary && fingerprint(next.writeups.filter((w) => w.slug !== slug)) === model.sourceFingerprint) {
      model.sourceFingerprint = next.sourceFingerprint;
    }
  } catch {}
  const contractFields = collectionFields('writeups');
  const item = toItem(summary ?? { slug, title: slug, published: false }, contractFields);
  model.items.push(item);
  model.origPublished.set(slug, item.published);
  model.created.push(slug);
  model.cursor = model.items.length - 1;
  const gate = await gateIssues(slug);
  model.issues.set(slug, gate.issues.get(slug) ?? []);
  model.flash = gate.error
    ? `${YELLOW}created ${WRITEUPS_FOLDER}/${slug}/; gate issues unavailable: ${gate.error}${RESET}`
    : `${GREEN}created ${WRITEUPS_FOLDER}/${slug}/ · fill in the frontmatter${RESET}`;
  return true;
}

// The writeup under the cursor, for the views that only open on one.
export function current(model: Model): Item {
  const item = model.items[model.cursor];
  if (!item) throw new Error('no writeup under the cursor');
  return item;
}

export function currentField(model: Model): Field {
  const field = FIELDS[model.field];
  if (!field) throw new Error('no field under the cursor');
  return field;
}
