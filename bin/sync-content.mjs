#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { parseFrontmatter, stringifyFrontmatter } from '../src/lib/frontmatter.mjs';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vaultRoot = process.env.VAULT_DIR
  ? path.resolve(process.env.VAULT_DIR)
  : path.resolve(siteRoot, '../../Severino Labs');

const includeDrafts = process.argv.includes('--drafts');

const lifeVaultRoot = process.env.LIFE_VAULT_DIR
  ? path.resolve(process.env.LIFE_VAULT_DIR)
  : path.resolve(siteRoot, '../../../Life');

const sourcePages = path.join(vaultRoot, '06 Pages');
const sourceWriteups = path.join(vaultRoot, '05 Writeups');
const sourceResume = path.join(lifeVaultRoot, 'Career', 'resume.md');
const targetPages = path.join(siteRoot, 'src/content/pages');
const targetTechnologyGroups = path.join(siteRoot, 'src/content/technology-groups.md');
const targetWriteups = path.join(siteRoot, 'src/content/writeups');
const targetWriteupAssets = path.join(siteRoot, 'public/assets/writeups');
const targetPageAssets = path.join(siteRoot, 'public/assets/pages');
const targetImageManifest = path.join(siteRoot, 'src/lib/image-manifest.json');
const syncManifestPath = path.join(siteRoot, 'node_modules/.cache/jseverino-sync-manifest.json');
const imageCacheDir = path.join(siteRoot, 'node_modules/.cache/jseverino-img');

const VARIANT_WIDTHS = [512, 1024, 1600];
const imageManifest = {};
// Every file written under the managed content/asset roots this run. Sync writes
// in place and prunes only files NOT in this set at the very end — so a partial
// or flaky pass (this repo lives in iCloud) can never delete committed assets;
// deletions happen once, after a complete pass, and only for true orphans.
const writtenFiles = new Set();
let syncManifest = {};

try {
  syncManifest = JSON.parse(fs.readFileSync(syncManifestPath, 'utf8'));
} catch {
  syncManifest = {};
}

const today = new Date().toISOString().slice(0, 10);

async function copyFile(source, target) {
  await fsPromises.mkdir(path.dirname(target), { recursive: true });
  await fsPromises.copyFile(source, target);
  writtenFiles.add(target);
}

function normalizeLocalAssetRef(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return undefined;
  if (/^(?:https?:)?\/\//.test(ref)) return undefined;
  if (ref.startsWith('#') || ref.startsWith('data:') || ref.startsWith('mailto:')) return undefined;

  const [withoutHash] = ref.split('#');
  const [withoutQuery] = withoutHash.split('?');
  const decoded = decodeURIComponent(withoutQuery)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');

  const imagesIndex = decoded.indexOf('images/');
  if (imagesIndex === -1) return undefined;
  return decoded.slice(imagesIndex);
}

function collectMarkdownAssetRefs(markdown) {
  const refs = new Set();
  const patterns = [
    /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    /\bsrc=["']([^"']+)["']/g
  ];

  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      const ref = normalizeLocalAssetRef(match[1]);
      if (ref) refs.add(ref);
    }
  }
  return refs;
}

const OPTIMIZABLE = /\.(?:png|jpe?g)$/i;

async function optimizeImage(source, target, url) {
  try {
    const buffer = await fsPromises.readFile(source);
    const meta = await sharp(buffer).metadata();
    const intrinsicW = meta.width ?? 0;
    const intrinsicH = meta.height ?? 0;
    if (!intrinsicW || !intrinsicH) throw new Error('unreadable dimensions');

    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const dir = path.dirname(target);
    const ext = path.extname(target);
    const base = path.basename(target, ext);
    const urlDir = url.slice(0, url.lastIndexOf('/'));
    await fsPromises.mkdir(dir, { recursive: true });

    const maxWidth = VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
    const widths = [
      ...new Set([
        ...VARIANT_WIDTHS.filter((width) => width < intrinsicW),
        Math.min(intrinsicW, maxWidth),
      ]),
    ].sort((a, b) => a - b);

    const emit = async (outName, cacheName, encode) => {
      const outFile = path.join(dir, outName);
      const cacheFile = path.join(imageCacheDir, cacheName);
      try {
        await fsPromises.access(cacheFile);
        await fsPromises.copyFile(cacheFile, outFile);
      } catch {
        const encoded = await encode();
        await fsPromises.writeFile(outFile, encoded);
        await fsPromises.copyFile(outFile, cacheFile);
      }
      writtenFiles.add(outFile);
    };

    const avif = [];
    const webp = [];
    for (const width of widths) {
      const avifName = `${base}-${width}.avif`;
      const webpName = `${base}-${width}.webp`;
      await emit(avifName, `${hash}-${width}.avif`, () =>
        sharp(buffer).resize({ width }).avif({ quality: 60 }).toBuffer(),
      );
      await emit(webpName, `${hash}-${width}.webp`, () =>
        sharp(buffer).resize({ width }).webp({ quality: 82 }).toBuffer(),
      );
      avif.push([width, `${urlDir}/${avifName}`]);
      webp.push([width, `${urlDir}/${webpName}`]);
    }

    await emit(path.basename(target), `${hash}-fallback${ext}`, () => {
      const pipeline = sharp(buffer).resize({
        width: Math.min(intrinsicW, maxWidth),
        withoutEnlargement: true,
      });
      return (
        ext.toLowerCase() === '.png' ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 82 })
      ).toBuffer();
    });

    imageManifest[url] = { w: intrinsicW, h: intrinsicH, avif, webp, fallback: url };
  } catch (error) {
    console.warn(`[images] could not optimize ${url} (${error.message}); copying original`);
    await copyFile(source, target);
  }
}

async function processReferencedAssets(refs, sourceDir, targetDir, urlPrefix) {
  for (const ref of refs) {
    const source = path.resolve(sourceDir, ref);
    const target = path.resolve(targetDir, ref);

    if (!source.startsWith(sourceDir + path.sep)) {
      throw new Error(`Refusing to copy asset outside source directory: ${ref}`);
    }
    try {
      await fsPromises.access(source);
    } catch {
      throw new Error(`Missing referenced asset: ${source}`);
    }

    if (OPTIMIZABLE.test(ref)) {
      await optimizeImage(source, target, `${urlPrefix}/${ref}`);
    } else {
      await copyFile(source, target);
    }
  }
}

function publicWriteupData(data, contentHash, slug) {
  const previousHash = syncManifest[slug];
  const isChanged = typeof previousHash === 'string' && previousHash !== contentHash;
  const lastReviewed = isChanged ? today : data.last_reviewed || data.published_at || today;

  syncManifest[slug] = contentHash;

  return {
    title: data.title,
    description: data.description,
    published: data.published === true,
    ...(data.published_at ? { published_at: data.published_at } : {}),
    last_reviewed: lastReviewed,
    ...(data.cover_image ? { cover_image: data.cover_image } : {}),
    ...(data.cover_alt ? { cover_alt: data.cover_alt } : {}),
    technologies: Array.isArray(data.technologies) ? data.technologies : [],
    featured: Boolean(data.featured),
    ...(Number.isInteger(data.featured_order) ? { featured_order: data.featured_order } : {}),
  };
}

function publicPageData(data) {
  return {
    title: data.title,
    ...(data.description ? { description: data.description } : {}),
    ...(data.intro ? { intro: data.intro } : {}),
    ...(data.path ? { path: data.path } : {}),
    published: data.published === true,
  };
}

function rewritePageAssetPaths(markdown, slug) {
  return markdown
    .replaceAll('./images/', `/assets/pages/${slug}/images/`)
    .replaceAll('](images/', `](/assets/pages/${slug}/images/`)
    .replaceAll('src="./images/', `src="/assets/pages/${slug}/images/`)
    .replaceAll('src="images/', `src="/assets/pages/${slug}/images/`);
}

function rewriteWriteupAssetPaths(markdown, slug) {
  return markdown
    .replaceAll('./images/', `/assets/writeups/${slug}/images/`)
    .replaceAll('](images/', `](/assets/writeups/${slug}/images/`);
}

function stripHtmlTags(value) {
  let current = value;
  let previous;
  do {
    previous = current;
    current = current.replace(/<[^>]+>/g, '');
  } while (current !== previous);
  return current;
}

function normalizeDescription(text) {
  const withoutMarkdownLinks = text
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '');

  return stripHtmlTags(withoutMarkdownLinks)
    .replace(/\\$/gm, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripRepeatedDescription(markdown, description) {
  if (typeof description !== 'string' || !description.trim()) return markdown;

  const expected = normalizeDescription(description);
  const lines = markdown.split(/\r?\n/);
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const isCandidate =
      (trimmed.startsWith('>') || trimmed.startsWith('[') || /^[A-Z0-9]/.test(trimmed)) &&
      output.some((previous) => /^#\s+/.test(previous.trim()));

    if (!isCandidate) {
      output.push(line);
      index += 1;
      continue;
    }

    const start = index;
    const candidate = [];
    while (index < lines.length && lines[index].trim() !== '') {
      candidate.push(lines[index]);
      index += 1;
    }

    const text = normalizeDescription(candidate.join(' ').replace(/^>\s?/gm, ''));
    if (text === expected) {
      while (index < lines.length && lines[index].trim() === '') index += 1;
      continue;
    }

    output.push(...lines.slice(start, index));
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

async function syncPages() {
  const entries = await fsPromises.readdir(sourcePages, { withFileTypes: true });
  await fsPromises.mkdir(targetPages, { recursive: true });
  await fsPromises.mkdir(targetPageAssets, { recursive: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name === '_technology-groups.md') {
      await copyFile(path.join(sourcePages, entry.name), targetTechnologyGroups);
      continue;
    }
    if (entry.isFile() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

    const slug = entry.name;
    const sourceDir = path.join(sourcePages, slug);
    const sourceIndex = path.join(sourceDir, 'index.md');
    try {
      await fsPromises.access(sourceIndex);
    } catch {
      continue;
    }

    const raw = await fsPromises.readFile(sourceIndex, 'utf8');
    const parsed = parseFrontmatter(raw);
    if (!includeDrafts && parsed.data.published !== true) continue;

    if (parsed.data.education_index) {
      await syncEducation(parsed);
      continue;
    }

    const refs = collectMarkdownAssetRefs(parsed.content);
    let rewrittenBody = rewritePageAssetPaths(parsed.content, slug);
    if (parsed.data.document_layout) {
      rewrittenBody = renderDocumentRows(await loadResumeGrammar(), rewrittenBody);
    }
    const synced = stringifyFrontmatter(rewrittenBody, publicPageData(parsed.data));

    await fsPromises.mkdir(targetPages, { recursive: true });
    const pageTarget = path.join(targetPages, `${slug}.md`);
    await fsPromises.writeFile(pageTarget, synced);
    writtenFiles.add(pageTarget);

    await processReferencedAssets(
      refs,
      sourceDir,
      path.join(targetPageAssets, slug),
      `/assets/pages/${slug}`,
    );
  }
}

// The resume page is the one page whose canonical lives outside the Labs
// vault: the Life vault's Career/resume.md also drives the PDF/markdown
// artifacts. The line grammar, surface-marker semantics, and tenure-span
// math live in resume-engine's lib/grammar.mjs, imported here so the two
// renderers can never drift (local-only: CI runs publish:check --no-sync).
// The frontmatter whitelist in publicPageData keeps contact fields (the
// phone number) out of this public repo.
const resumeEngineRoot = process.env.RESUME_ENGINE_DIR
  ? path.resolve(process.env.RESUME_ENGINE_DIR)
  : path.resolve(siteRoot, '../../Assets/resume-engine');

// Multi-role orgs carry a summarized tenure span on the org row, matching
// the PDF's date column; the location tucks under it.
function orgRow(grammar, lines, index, org) {
  const dates = grammar.orgRoleDates(lines, index);
  const meta =
    dates.length > 1
      ? `<span class="resume-org-meta"><span class="resume-dates">${grammar.tenureSpan(dates)}</span><span class="resume-loc">${org.location}</span></span>`
      : `<span class="resume-loc">${org.location}</span>`;
  const educationPath = educationLinks.get(org.name);
  const name = educationPath ? `<a href="${educationPath}">${org.name}</a>` : org.name;
  return `<h3 class="resume-org"><span>${name}</span>${meta}</h3>`;
}

function resumeRow(grammar, line) {
  const role = grammar.matchRole(line);
  if (role) {
    return `<p class="resume-role"><strong>${role.title}</strong><span class="resume-dates">${role.dates}</span></p>`;
  }

  const cert = line.startsWith('- ') ? grammar.matchCert(line.slice(2)) : null;
  if (cert) {
    return `<p class="resume-cert"><a href="${cert.url}">${cert.name}</a><span class="resume-issuer">${cert.issuer}</span><span class="resume-dates">${cert.date}</span></p>`;
  }

  const projectMeta = grammar.matchProjectMeta(line);
  if (projectMeta) {
    return `<p class="resume-projmeta"><a href="${projectMeta.href}">${projectMeta.label}</a><span class="resume-dates">${projectMeta.date}</span></p>`;
  }

  return line;
}

// Render the shared document grammar (schools/orgs, courses/roles, bullets,
// certs, project meta) to classed HTML rows. The resume page renders through
// this, and so does any 06 Pages page marked `document_layout: true` (the
// education page) — one row renderer, one CSS block, no duplication.
function renderDocumentRows(grammar, rawContent) {
  const lines = grammar.linesForSite(rawContent.split('\n'));
  return lines
    .map((line, index) => {
      const org = grammar.matchOrg(line);
      return org ? orgRow(grammar, lines, index, org) : resumeRow(grammar, line);
    })
    .join('\n');
}

let cachedGrammar;
async function loadResumeGrammar() {
  if (cachedGrammar) return cachedGrammar;
  const grammarPath = path.join(resumeEngineRoot, 'lib', 'grammar.mjs');
  if (!fs.existsSync(grammarPath)) {
    throw new Error(`resume grammar not found: ${grammarPath} (clone resume-engine or set RESUME_ENGINE_DIR)`);
  }
  cachedGrammar = await import(pathToFileURL(grammarPath).href);
  return cachedGrammar;
}

let cachedResume;
async function loadResume() {
  cachedResume ??= parseFrontmatter(await fsPromises.readFile(sourceResume, 'utf8'));
  return cachedResume;
}

async function syncResume() {
  const grammar = await loadResumeGrammar();
  const parsed = await loadResume();
  if (!includeDrafts && parsed.data.published !== true) return;

  const content = renderDocumentRows(grammar, parsed.content);
  const synced = stringifyFrontmatter(content, publicPageData(parsed.data));
  const pageTarget = path.join(targetPages, 'resume.md');
  await fsPromises.writeFile(pageTarget, synced);
  writtenFiles.add(pageTarget);
}

// ── Education pages ─────────────────────────────────────────────────
// /education/ derives from two governed sources, each owning only what it
// alone knows:
//
//   • The resume canonical's EDUCATION section (the same lines behind the
//     PDF and /resume/) owns institution identity — name, location, degree,
//     dates. A graduation-date change lands in one file.
//   • `severino-edu-mcp export` owns coursework: the Education vault's
//     publishable projection (institutions with slug + description; courses
//     with code/title/term/status and their `## Site` bullets), validated
//     against the education schema profile and joined to the resume org by
//     institution name. The vault is never parsed here — the engine that
//     governs MCP writes emits the dataset, the way HQ consumes
//     `schema --json`. resume-engine's coursework reconciler reads the same
//     export, so the three surfaces cannot drift.
//
// Surface policy stays at the surface: a course row renders once its status
// is active or completed AND it has Site bullets. The 06 Pages page marked
// `education_index: true` is the /education/ shell (title, description,
// intro, optional lead prose); its published flag gates the whole tree.
// Resume-only institutions with no vault presence stay off /education/.
const execFileAsync = promisify(execFile);

let cachedEducationDataset;
async function loadEducationDataset() {
  if (cachedEducationDataset) return cachedEducationDataset;
  let stdout;
  try {
    ({ stdout } = await execFileAsync('severino-edu-mcp', ['export']));
  } catch (error) {
    let detail;
    try {
      detail = JSON.parse(error.stdout).errors?.join('\n  ');
    } catch {
      detail = error.stderr?.trim() || error.message;
    }
    throw new Error(
      `education export failed (severino-edu-mcp export):\n  ${detail}\n` +
        'Install/update with: uv tool install --reinstall ~/Documents/Code/Assets/severino-edu-mcp',
    );
  }
  cachedEducationDataset = JSON.parse(stdout);
  return cachedEducationDataset;
}

const SITE_COURSE_STATUSES = new Set(['active', 'completed']);

function publishableCourses(institution) {
  return institution.courses.filter(
    (course) => SITE_COURSE_STATUSES.has(course.status) && course.site_bullets,
  );
}

// Org names on /resume/ link to their /education/ page — populated only when
// syncEducation actually emits that page, so an unpublished education tree
// can never leave a dead link on the resume.
const educationLinks = new Map();

// The resume canonical's EDUCATION orgs with their degree row, in canonical
// order.
function resumeEducationOrgs(grammar, content) {
  const orgs = [];
  let inEducation = false;
  for (const line of grammar.linesForSite(content.split('\n'))) {
    if (/^## /.test(line)) {
      inEducation = /^## education$/i.test(line.trim());
      continue;
    }
    if (!inEducation) continue;
    const org = grammar.matchOrg(line);
    if (org) {
      orgs.push(org);
      continue;
    }
    const role = grammar.matchRole(line);
    if (role && orgs.length > 0 && !orgs.at(-1).degree) orgs.at(-1).degree = role;
  }
  return orgs;
}

function courseRow(course) {
  const code = course.code.replace(/(\d)/, ' $1');
  const dates = course.status === 'active' ? `${course.term} · in progress` : course.term;
  return `**${code} — ${course.title} (${dates})**`;
}

function courseProgress(courses) {
  const completed = courses.filter((course) => course.status === 'completed').length;
  const active = courses.filter((course) => course.status === 'active').length;
  return [
    completed > 0 ? `${completed} course${completed === 1 ? '' : 's'} completed` : '',
    active > 0 ? `${active} in progress` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

async function syncEducation(shell) {
  const grammar = await loadResumeGrammar();
  const resume = await loadResume();
  const dataset = await loadEducationDataset();
  const vaultInstitutions = new Map(
    dataset.institutions.map((entry) => [entry.institution, entry]),
  );
  const rows = [shell.content.trim()].filter(Boolean);

  for (const org of resumeEducationOrgs(grammar, resume.content)) {
    const institution = vaultInstitutions.get(org.name);
    if (!institution) continue;
    vaultInstitutions.delete(org.name);

    const courses = publishableCourses(institution);
    const detailBody = courses
      .map((course) => `${courseRow(course)}\n\n${course.site_bullets}`)
      .join('\n\n');
    const detail = stringifyFrontmatter(
      renderDocumentRows(grammar, detailBody),
      publicPageData({
        title: org.name,
        description: institution.description,
        intro: [org.degree?.title, org.location, org.degree?.dates].filter(Boolean).join(' · '),
        path: `/education/${institution.slug}/`,
        published: shell.data.published,
      }),
    );
    const detailTarget = path.join(targetPages, 'education', `${institution.slug}.md`);
    await fsPromises.mkdir(path.dirname(detailTarget), { recursive: true });
    await fsPromises.writeFile(detailTarget, detail);
    writtenFiles.add(detailTarget);
    educationLinks.set(org.name, `/education/${institution.slug}/`);

    const progress = courseProgress(courses);
    rows.push(
      `<h3 class="resume-org"><span><a href="/education/${institution.slug}/">${org.name}</a></span><span class="resume-loc">${org.location}</span></h3>`,
      ...(org.degree
        ? [
            `<p class="resume-role"><strong>${org.degree.title}</strong><span class="resume-dates">${org.degree.dates}</span></p>`,
          ]
        : []),
      ...(progress ? [`- ${progress}`] : []),
    );
  }

  if (vaultInstitutions.size > 0) {
    const orphans = [...vaultInstitutions.keys()].join(', ');
    throw new Error(
      `Education vault institution(s) missing from the resume canonical's EDUCATION section: ${orphans}`,
    );
  }

  const index = stringifyFrontmatter(rows.join('\n\n'), publicPageData(shell.data));
  const indexTarget = path.join(targetPages, 'education.md');
  await fsPromises.writeFile(indexTarget, index);
  writtenFiles.add(indexTarget);
}

async function syncWriteups() {
  const entries = await fsPromises.readdir(sourceWriteups, { withFileTypes: true });
  await fsPromises.mkdir(targetWriteups, { recursive: true });
  await fsPromises.mkdir(targetWriteupAssets, { recursive: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const slug = entry.name;
    const sourceDir = path.join(sourceWriteups, slug);
    const sourceIndex = path.join(sourceDir, 'index.md');
    try {
      await fsPromises.access(sourceIndex);
    } catch {
      continue;
    }

    const raw = await fsPromises.readFile(sourceIndex, 'utf8');
    const parsed = parseFrontmatter(raw);
    if (!includeDrafts && parsed.data.published !== true) continue;

    const content = stripRepeatedDescription(parsed.content, parsed.data.description);
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    const refs = collectMarkdownAssetRefs(content);
    const coverRef = normalizeLocalAssetRef(parsed.data.cover_image);
    if (coverRef) refs.add(coverRef);

    const rewrittenContent = rewriteWriteupAssetPaths(content, slug);
    const syncedMarkdown = stringifyFrontmatter(
      rewrittenContent,
      publicWriteupData(parsed.data, contentHash, slug),
    );

    const targetDir = path.join(targetWriteups, slug);
    await fsPromises.mkdir(targetDir, { recursive: true });
    const writeupTarget = path.join(targetDir, 'index.md');
    await fsPromises.writeFile(writeupTarget, syncedMarkdown);
    writtenFiles.add(writeupTarget);

    await processReferencedAssets(
      refs,
      sourceDir,
      path.join(targetWriteupAssets, slug),
      `/assets/writeups/${slug}`,
    );
  }
}

// Remove files under the managed roots that were NOT written this run — true
// orphans: unreferenced assets, unpublished pages/writeups, or stale variants
// from a changed source. Runs only after both passes complete, so an aborted or
// flaky run (iCloud) never deletes committed content; deletions happen once, at
// the end, and only for files no longer produced.
async function pruneOrphans(roots) {
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const walk = async (dir) => {
      for (const entry of await fsPromises.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          if ((await fsPromises.readdir(full)).length === 0) await fsPromises.rmdir(full);
        } else if (!writtenFiles.has(full)) {
          await fsPromises.rm(full, { force: true });
        }
      }
    };
    await walk(root);
  }
}

await fsPromises.mkdir(imageCacheDir, { recursive: true });
await syncPages();
await syncResume();
await syncWriteups();
await pruneOrphans([targetPages, targetPageAssets, targetWriteups, targetWriteupAssets]);

const sortedManifest = Object.fromEntries(
  Object.keys(imageManifest)
    .sort()
    .map((key) => [key, imageManifest[key]]),
);
await fsPromises.mkdir(path.dirname(targetImageManifest), { recursive: true });
await fsPromises.mkdir(path.dirname(syncManifestPath), { recursive: true });
await fsPromises.writeFile(targetImageManifest, `${JSON.stringify(sortedManifest, null, 2)}\n`);
await fsPromises.writeFile(syncManifestPath, JSON.stringify(syncManifest, null, 2));

console.log(`Synced pages from ${sourcePages}`);
console.log(`Synced public writeups from ${sourceWriteups}`);
console.log(
  `Optimized ${Object.keys(imageManifest).length} images → ${path.relative(siteRoot, targetImageManifest)}`,
);

if (includeDrafts) {
  console.log(
    'Included drafts (published: false) — local preview only; do not commit or publish this sync.',
  );
}
