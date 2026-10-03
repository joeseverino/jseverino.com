// The vault → repo projection. syncContent writes the public snapshot through
// one writer and returns exactly the files it owns; checkContent resolves the
// same references and contract without writing anything.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, stringifyFrontmatter, type FrontmatterData, type ParsedFrontmatter } from '../../src/lib/frontmatter.ts';
import { frontmatterIssues } from '../../src/lib/content-contract.ts';
import { parseTechnologyGroups } from '../../src/lib/technology-groups.ts';
import { createEducationSource, createResumeSource, createVaultSource, type EducationSource } from './source-adapters.ts';
import { createPublicProjection, stripArticleChrome, stripRepeatedDescription } from './public-projection.ts';
import {
  collectAssetRefs,
  createMasterEncoder,
  defaultConcurrency,
  mapLimit,
  normalizeLocalAssetRef,
  referenceIssues,
  resolveAssetSource,
  STRAY_REFERENCE,
  strayReferences,
} from './assets.ts';
import { compileIssues } from './compile.ts';
import { loadGrammar, renderDocumentRows, type Grammar } from './documents.ts';
import { buildEducation } from './education.ts';
import { createWriter, type SyncReport } from './writer.ts';
import { isoDate } from '../../src/lib/dates.ts';
import { DOCUMENT_FILE } from '../../src/lib/snapshot.ts';

export interface Layout {
  root: string;
  content: string;
  // Files copied verbatim into the layout.
  extras?: { from: string; to: string }[];
}

export interface SyncOptions {
  layout: Layout;
  vaultRoot: string;
  lifeVaultRoot: string;
  resumeEngineRoot: string;
  cacheDir: string;
  includeDrafts?: boolean;
  snapshotDir?: string;
  educationSource?: EducationSource;
  concurrency?: number;
  date?: string;
}

export interface SyncResult extends SyncReport {
  pages: number;
  writeups: number;
  images: number;
  warnings: string[];
  pagesRoot: string;
  writeupsRoot: string;
}

interface AssetJob {
  source: string;
  target: string;
}

// Each document is <collection>/<slug>/index.mdx with its images beside it.
const documentFile = (dir: string, slug: string): string => path.join(dir, slug, DOCUMENT_FILE);

// Where a sync writes. The committed layout is the repo snapshot; the overlay
// is a self-contained content root (SITE_CONTENT_ROOT) for draft previews.
export function committedLayout(root: string): Layout {
  return {
    root,
    content: path.join(root, 'src/content'),
  };
}

export function overlayLayout(root: string, siteRoot: string): Layout {
  return {
    root,
    content: root,
    extras: [{ from: path.join(siteRoot, 'src/data/github-repos.json'), to: path.join(root, 'github-repos.json') }],
  };
}

// The committed snapshot's writeup, read before the sync overwrites it.
function snapshotReader(contentDir: string): (slug: string) => ParsedFrontmatter | undefined {
  return (slug) => {
    const file = documentFile(path.join(contentDir, 'writeups'), slug);
    return fs.existsSync(file) ? parseFrontmatter(fs.readFileSync(file, 'utf8')) : undefined;
  };
}


export async function syncContent({
  layout,
  vaultRoot,
  lifeVaultRoot,
  resumeEngineRoot,
  cacheDir,
  includeDrafts = false,
  snapshotDir = layout.content,
  educationSource = createEducationSource(),
  concurrency = defaultConcurrency(),
  date = isoDate(),
}: SyncOptions): Promise<SyncResult> {
  const writer = createWriter({ root: layout.root });
  const vault = createVaultSource({ vaultRoot, includeDrafts });
  const resumeSource = createResumeSource({ lifeVaultRoot, includeDrafts });
  const projection = createPublicProjection({ today: date, previousWriteup: snapshotReader(snapshotDir) });
  const pagesDir = path.join(layout.content, 'pages');
  const writeupsDir = path.join(layout.content, 'writeups');
  const assetJobs: AssetJob[] = [];
  const warnings: string[] = [];

  // A draft's missing image is a warning, so a work in progress still previews;
  // a published document's is fatal.
  const queueAssets = (refs: Iterable<string>, sourceDir: string, collection: 'pages' | 'writeups', slug: string, published: boolean) => {
    for (const ref of refs) {
      const source = resolveAssetSource(sourceDir, ref);
      if (!fs.existsSync(source)) {
        if (published) throw new Error(`Missing referenced asset: ${source}`);
        warnings.push(`draft ${collection}/${slug}: missing image ${ref}`);
        continue;
      }
      assetJobs.push({ source, target: path.join(layout.content, collection, slug, ref) });
    }
  };

  // As with images: a published document stops the sync, a draft warns.
  const refuseStrays = (markdown: string, collection: 'pages' | 'writeups', slug: string, published: boolean) => {
    for (const { raw } of strayReferences(markdown)) {
      if (published) throw new Error(`${collection}/${slug}: ${STRAY_REFERENCE}: ${raw}`);
      warnings.push(`draft ${collection}/${slug}: ${STRAY_REFERENCE}: ${raw}`);
    }
  };

  let grammar: Grammar | undefined;
  const documentGrammar = async (): Promise<Grammar> => (grammar ??= await loadGrammar(resumeEngineRoot));

  await writer.copy(vault.technologyGroups, path.join(layout.content, 'technology-groups.md'));
  for (const { from, to } of layout.extras ?? []) await writer.copy(from, to);

  // Education first: it decides which resume orgs link to an /education/ page,
  // and every document renderer after it receives those links explicitly.
  const pages = await vault.pages();
  const shell = pages.find(({ parsed }) => parsed.data.education_index);
  let educationLinks = new Map<string, string>();
  if (shell) {
    const resume = await resumeSource.load();
    if (!resume) throw new Error(`education page needs the published resume canonical: ${resumeSource.sourceFile}`);
    const education = buildEducation({
      grammar: await documentGrammar(),
      shell: shell.parsed,
      resume,
      dataset: await educationSource.load(),
      projectPage: projection.page,
    });
    for (const { page, content } of education.pages) await writer.write(path.join(pagesDir, page), content);
    educationLinks = education.links;
  }

  for (const { slug, sourceDir, parsed } of pages) {
    if (parsed === shell?.parsed) continue;
    refuseStrays(parsed.content, 'pages', slug, parsed.data.published === true);
    let body = parsed.content;
    if (parsed.data.document_layout) body = renderDocumentRows(await documentGrammar(), body, educationLinks);
    await writer.write(documentFile(pagesDir, slug), stringifyFrontmatter(body, projection.page(parsed.data)));
    queueAssets(collectAssetRefs(parsed.content), sourceDir, 'pages', slug, parsed.data.published === true);
  }

  const resume = await resumeSource.load();
  if (resume) {
    const body = renderDocumentRows(await documentGrammar(), resume.content, educationLinks);
    await writer.write(documentFile(pagesDir, 'resume'), stringifyFrontmatter(body, projection.page(resume.data)));
  }

  const writeups = await vault.writeups();
  for (const { slug, sourceDir, parsed } of writeups) {
    const body = stripArticleChrome(stripRepeatedDescription(parsed.content, parsed.data.description));
    refuseStrays(body, 'writeups', slug, parsed.data.published === true);
    const refs = collectAssetRefs(body);
    const coverRef = normalizeLocalAssetRef(parsed.data.cover_image);
    if (coverRef) refs.add(coverRef);
    await writer.write(documentFile(writeupsDir, slug), stringifyFrontmatter(body, projection.writeup(parsed.data, { slug, body })));
    queueAssets(refs, sourceDir, 'writeups', slug, parsed.data.published === true);
  }

  const master = createMasterEncoder(cacheDir);
  await mapLimit(assetJobs, concurrency, async ({ source, target }) => writer.write(target, await master(source)));
  await writer.prune([pagesDir, writeupsDir]);

  return {
    ...writer.report(),
    pages: pages.length + (resume ? 1 : 0),
    writeups: writeups.length,
    images: assetJobs.length,
    warnings,
    pagesRoot: vault.pagesRoot,
    writeupsRoot: vault.writeupsRoot,
  };
}

const PLACEHOLDER = /CHANGEME/;
const DESCRIPTION_LIMIT = 300;

// Writeup rules beyond the contract's types. draft tolerates the two that only
// matter at ship time: the published flag and its date.
function writeupIssues(data: FrontmatterData, { draft, catalog }: { draft: boolean; catalog: ReadonlySet<string> }): string[] {
  const issues: string[] = [];
  if (!draft && data.published !== true) issues.push('published is not true (validate a draft with --draft)');
  if (!draft && !data.published_at) issues.push('missing published_at');
  if (!draft && !data.cover_image) issues.push('missing cover_image');
  if (typeof data.description === 'string' && data.description.trim().length > DESCRIPTION_LIMIT) {
    issues.push(`description is ${data.description.trim().length} characters (limit ${DESCRIPTION_LIMIT})`);
  }
  for (const field of ['title', 'description', 'cover_alt']) {
    if (PLACEHOLDER.test(String(data[field] ?? ''))) issues.push(`${field} still holds the template placeholder`);
  }
  for (const slug of Array.isArray(data.technologies) ? (data.technologies as unknown[]) : []) {
    if (typeof slug !== 'string' || !catalog.has(slug)) issues.push(`technology slug not in the catalog: ${slug}`);
  }
  return issues;
}

// Every reference and contract problem across the vault's public documents,
// without writing. slug narrows to one writeup; draft includes unpublished
// writeups and tolerates the publish-only rules.
/** @param {{ vaultRoot: string, slug?: string, draft?: boolean }} options */
export interface CheckedDocument {
  collection: 'writeups' | 'pages';
  slug: string;
  published: boolean;
  issues: string[];
}

export interface CheckOptions {
  vaultRoot: string;
  slug?: string | undefined;
  draft?: boolean | undefined;
}

export async function checkContent({ vaultRoot, slug, draft = false }: CheckOptions): Promise<{ ok: boolean; documents: CheckedDocument[] }> {
  const vault = createVaultSource({ vaultRoot, includeDrafts: true });
  const catalog = new Set(
    parseTechnologyGroups(fs.existsSync(vault.technologyGroups) ? fs.readFileSync(vault.technologyGroups, 'utf8') : '')
      .flatMap((group) => group.tags.map((tag) => tag.slug)),
  );
  const documents: CheckedDocument[] = [];

  const writeups = (await vault.writeups()).filter((entry) =>
    slug ? entry.slug === slug : draft || entry.parsed.data.published === true);
  if (slug && writeups.length === 0) {
    documents.push({ collection: 'writeups', slug, published: false, issues: [`writeup not found: ${path.join(vault.writeupsRoot, slug)}`] });
  }
  for (const { slug: name, sourceDir, parsed } of writeups) {
    const content = stripRepeatedDescription(parsed.content, parsed.data.description);
    documents.push({
      collection: 'writeups',
      slug: name,
      published: parsed.data.published === true,
      issues: [
        ...frontmatterIssues('writeups', parsed.data),
        ...writeupIssues(parsed.data, { draft, catalog }),
        ...(await referenceIssues(content, sourceDir, { cover: parsed.data.cover_image })),
        ...compileIssues(stripArticleChrome(content), 'writeups'),
      ],
    });
  }

  if (!slug) {
    const pages = (await vault.pages()).filter((entry) => draft || entry.parsed.data.published === true);
    for (const { slug: name, sourceDir, parsed } of pages) {
      documents.push({
        collection: 'pages',
        slug: name,
        published: parsed.data.published === true,
        issues: [
          ...frontmatterIssues('pages', parsed.data),
          ...(await referenceIssues(parsed.content, sourceDir)),
          ...compileIssues(parsed.content, 'pages'),
        ],
      });
    }
  }

  return { ok: documents.every((doc) => doc.issues.length === 0), documents };
}
