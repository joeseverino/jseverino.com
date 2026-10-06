#!/usr/bin/env node
// What a content change means, by slug: which writeups it publishes, edits, or
// removes, which pages it touches, and how many generated files ride along.
// One classifier for publish (commit message, PR body), land (what to verify),
// and publish:check (its content status line).
//
//   node bin/content-diff.ts [--range <a..b> | --cached] [--json]
import { cli, flag } from './lib/args.ts';
import { statusEntries } from './lib/git.ts';
import { runSync } from './lib/run.ts';
import { siteRoot } from '../src/lib/site-root.ts';

// Everything the content sync owns.
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
  range?: string | undefined;
  cached?: boolean | undefined;
}

const STATUS: Record<string, FileStatus> = { A: 'A', D: 'D', '?': 'A' };

// [{ status: 'A'|'M'|'D', path }] for a range (`a..b`, `a...b`), the index
// (cached), or the working tree against HEAD including untracked files.
function changedFiles({ cwd = siteRoot, range, cached = false }: DiffOptions = {}): ChangedFile[] {
  if (range || cached) {
    const out = runSync('git', ['diff', '--name-status', '--no-renames', '-z', ...(cached || !range ? ['--cached'] : [range]), '--', ...CONTENT_PATHS], { cwd, raw: true });
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

// Each document is <collection>/<slug>/index.mdx; the image masters the sync
// prepares sit in its images/ folder.
const WRITEUP_INDEX = /^src\/content\/writeups\/([^/]+)\/index\.mdx$/;
const WRITEUP_FILE = /^src\/content\/writeups\/([^/]+)\//;
const PAGE_FILE = /^src\/content\/pages\/(.+?)\/(?:index\.mdx|images\/)/;
const ROOT_FILE = /^src\/content\/([^/]+)\.md$/;
const GENERATED = /^src\/content\/.+\/images\//;

type WriteupChange = 'published' | 'edited' | 'removed';

export function classify(files: readonly ChangedFile[]): ContentDiff {
  const writeups = new Map<string, WriteupChange>();
  const pages = new Set<string>();
  const generated: string[] = [];
  for (const { status, path: file } of files) {
    if (GENERATED.test(file)) generated.push(file);
    let slug: string | undefined;
    if ((slug = WRITEUP_INDEX.exec(file)?.[1])) {
      writeups.set(slug, status === 'A' ? 'published' : status === 'D' ? 'removed' : writeups.get(slug) ?? 'edited');
    } else if ((slug = WRITEUP_FILE.exec(file)?.[1])) {
      if (!writeups.has(slug)) writeups.set(slug, 'edited');
    } else if ((slug = (PAGE_FILE.exec(file) ?? ROOT_FILE.exec(file))?.[1])) {
      pages.add(slug);
    }
  }
  const of = (kind: WriteupChange): string[] => [...writeups].filter(([, k]) => k === kind).map(([slug]) => slug).sort();
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
  return ([
    ['published', diff.published],
    ['edited', diff.edited],
    ['removed', diff.removed],
    ['pages', diff.pages],
  ] as const)
    .filter(([, slugs]) => slugs.length > 0)
    .map(([kind, slugs]) => `${kind} ${slugs.length}: ${slugs.join(', ')}`)
    .concat(diff.generated.count > 0 ? [`${diff.generated.count} generated files`] : [])
    .join('; ');
}

// A lone change names itself; several summarize by count with the slugs in the body.
export function commitMessage(diff: ContentDiff): string {
  // [verb for a lone change, count label, body heading, slugs]
  const groups = ([
    ['publish', 'publish', 'Published', diff.published],
    ['edit', 'edit', 'Edited', diff.edited],
    ['remove', 'remove', 'Removed', diff.removed],
    ['edit page', 'pages', 'Pages', diff.pages],
  ] as const).filter(([, , , slugs]) => slugs.length > 0);
  const total = groups.reduce((sum, [, , , slugs]) => sum + slugs.length, 0);
  if (total === 0) return 'content: refresh generated assets';
  const [lone] = groups;
  if (total === 1 && lone) return `content: ${lone[0]} ${lone[3][0]}`;
  const subject = `content: ${groups.map(([, label, , slugs]) => `${label} ${slugs.length}`).join(', ')}`;
  const body = groups.map(([, , heading, slugs]) => `${heading}:\n${slugs.map((slug) => `  - ${slug}`).join('\n')}`).join('\n\n');
  return `${subject}\n\n${body}`;
}

if (import.meta.main) {
  const { values } = cli({
    usage: 'usage: node bin/content-diff.ts [--range <a..b> | --cached] [--json]',
    options: {
      range: { type: 'string' },
      cached: flag,
      json: flag,
    },
  });
  const diff = contentDiff({ range: values.range, cached: values.cached });
  if (values.json) console.log(JSON.stringify(diff, null, 2));
  else console.log(`${describeDiff(diff)}\n\n${commitMessage(diff)}`);
}
