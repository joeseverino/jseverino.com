// Classify a content change by slug: writeups published, edited, or removed, pages
// touched, generated files riding along. Shared by publish and land.

import { siteRoot } from '../src/lib/site-root.ts';
import { statusEntries } from './lib/git.ts';
import { runSync } from './lib/run.ts';

export const CONTENT_PATHS = ['src/content'];

export type FileStatus = 'A' | 'M' | 'D';
export interface ChangedFile {
  status: FileStatus;
  path: string;
}

export interface ContentDiff {
  published: string[];
  edited: string[];
  removed: string[];
  pages: string[];
  generated: { count: number; paths: string[] };
}

export interface DiffOptions {
  cwd?: string;
  range?: string;
}

const STATUS: Record<string, FileStatus> = { A: 'A', D: 'D' };

// The files a range (`a..b`, `a...b`) changes, or without one, the working
// tree against HEAD including untracked files.
function changedFiles({ cwd = siteRoot, range }: DiffOptions = {}): ChangedFile[] {
  if (range) {
    const out = runSync('git', ['diff', '--name-status', '--no-renames', '-z', range, '--', ...CONTENT_PATHS], { cwd, raw: true });
    const fields = out.split('\0').filter(Boolean);
    const files: ChangedFile[] = [];
    for (let i = 0; i + 1 < fields.length; i += 2) files.push({ status: STATUS[fields[i]?.[0] ?? ''] ?? 'M', path: fields[i + 1] ?? '' });
    return files;
  }
  return statusEntries(cwd, ...CONTENT_PATHS).map((entry): ChangedFile => {
    const code = entry.slice(0, 2);
    const status: FileStatus = code.includes('D') ? 'D' : code === '??' || code.includes('A') ? 'A' : 'M';
    return { status, path: entry.slice(3) };
  });
}

const WRITEUP_INDEX = /^src\/content\/writeups\/([^/]+)\/index\.mdx$/;
const WRITEUP_FILE = /^src\/content\/writeups\/([^/]+)\//;
const PAGE_FILE = /^src\/content\/pages\/(.+?)\/(?:index\.mdx|images\/)/;
const ROOT_FILE = /^src\/content\/([^/]+)\.md$/;
const GENERATED = /^src\/content\/.+\/images\//;

type WriteupChange = 'published' | 'edited' | 'removed';

// Records what a changed file does to its writeup, if it belongs to one: the index's own add or
// delete publishes or removes it, and any other change edits it unless something stronger is recorded.
function recordWriteup(writeups: Map<string, WriteupChange>, file: string, status: FileStatus): boolean {
  const index = WRITEUP_INDEX.exec(file)?.[1];
  if (index) {
    writeups.set(index, status === 'A' ? 'published' : status === 'D' ? 'removed' : (writeups.get(index) ?? 'edited'));
    return true;
  }
  const writeupFile = WRITEUP_FILE.exec(file)?.[1];
  if (!writeupFile) return false;
  if (!writeups.has(writeupFile)) writeups.set(writeupFile, 'edited');
  return true;
}

function classify(files: readonly ChangedFile[]): ContentDiff {
  const writeups = new Map<string, WriteupChange>();
  const pages = new Set<string>();
  const generated: string[] = [];
  for (const { status, path: file } of files) {
    if (GENERATED.test(file)) generated.push(file);
    if (recordWriteup(writeups, file, status)) continue;
    const page = (PAGE_FILE.exec(file) ?? ROOT_FILE.exec(file))?.[1];
    if (page) pages.add(page);
  }
  const of = (kind: WriteupChange): string[] =>
    [...writeups]
      .filter(([, k]) => k === kind)
      .map(([slug]) => slug)
      .sort();
  return {
    published: of('published'),
    edited: of('edited'),
    removed: of('removed'),
    pages: [...pages].sort(),
    generated: { count: generated.length, paths: generated.sort() },
  };
}

export const contentDiff = (options?: DiffOptions): ContentDiff => classify(changedFiles(options));

export const isEmpty = (diff: ContentDiff): boolean =>
  diff.published.length + diff.edited.length + diff.removed.length + diff.pages.length + diff.generated.count === 0;

export function describeDiff(diff: ContentDiff): string {
  if (isEmpty(diff)) return 'no content changes';
  return (
    [
      ['published', diff.published],
      ['edited', diff.edited],
      ['removed', diff.removed],
      ['pages', diff.pages],
    ] as const
  )
    .filter(([, slugs]) => slugs.length > 0)
    .map(([kind, slugs]) => `${kind} ${slugs.length}: ${slugs.join(', ')}`)
    .concat(diff.generated.count > 0 ? [`${diff.generated.count} generated files`] : [])
    .join('; ');
}

export function commitMessage(diff: ContentDiff): string {
  // [verb for a lone change, count label, body heading, slugs]
  const groups = (
    [
      ['publish', 'publish', 'Published', diff.published],
      ['edit', 'edit', 'Edited', diff.edited],
      ['remove', 'remove', 'Removed', diff.removed],
      ['edit page', 'pages', 'Pages', diff.pages],
    ] as const
  ).filter(([, , , slugs]) => slugs.length > 0);
  const total = groups.reduce((sum, [, , , slugs]) => sum + slugs.length, 0);
  if (total === 0) return 'content: refresh generated assets';
  const [lone] = groups;
  if (total === 1 && lone) return `content: ${lone[0]} ${lone[3][0]}`;
  const subject = `content: ${groups.map(([, label, , slugs]) => `${label} ${slugs.length}`).join(', ')}`;
  const body = groups.map(([, , heading, slugs]) => `${heading}:\n${slugs.map((slug) => `  - ${slug}`).join('\n')}`).join('\n\n');
  return `${subject}\n\n${body}`;
}
