// Engineering docs integrity that no link checker knows: every `mise run` reference names a task,
// no doc runs an npm script (package.json has none; every command is a mise task), every
// backticked repo path resolves (git tracks or ignores it), and every backticked bare file name
// is a tracked file's, so a renamed file leaves no stale name behind. Command refs are checked
// everywhere, fenced code included. The lists a doc keeps for its reader (the security headers,
// the raw HTML tags, the table of every spec and audit) match their source. Links and #anchors are lychee's
// (`mise run checks:doc-links`).

import fs from 'node:fs';
import path from 'node:path';
import { trackedFiles } from '../../bin/lib/git.ts';
import { miseTasks, namesTask } from '../../bin/lib/mise.ts';
import { spawnResult } from '../../bin/lib/run.ts';
import { parseHeaders } from '../../src/lib/headers-file.ts';
import { RAW_HTML_TAGS } from '../../src/lib/markdown/guard.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { abort, finish } from './lib.ts';

export interface PathRef {
  line: number;
  path: string;
}

const PLACEHOLDER = /[*<>{}$[\]()|"'`?]/;

// A token without its `NAME=` prefix, #fragment, ?query and :line suffix.
const bare = (token: string): string =>
  token
    .slice(token.lastIndexOf('=') + 1)
    .replace(/[#?].*$/, '')
    .replace(/:\d+(?:-\d+)?$/, '');

// The repo path a backticked token names, or null when it names none.
export function repoPath(token: string, topLevel: ReadonlySet<string>): string | null {
  let candidate = bare(token);
  const wild = candidate.search(PLACEHOLDER);
  if (wild === 0) return null;
  if (wild > 0) {
    const slash = candidate.lastIndexOf('/', wild);
    if (slash < 0) return null;
    candidate = candidate.slice(0, slash + 1);
  }
  const [first, ...rest] = candidate.split('/');
  if (!first || rest.length === 0 || !topLevel.has(first)) return null;
  return candidate;
}

// A source file's extension: a doc names one of these by its tracked file. Images and build
// output are left out, since the docs name those as served or as another system's.
const FILE_NAME = /^[\w.-]*[\w-]\.(?:astro|css|fig|grit|json|jsonc|md|mdx|mjs|pdf|sh|sql|toml|ts|ya?ml)$/;
// Files the docs name that git never tracks here: severino-brand's token source, the vault's
// taxonomy note the sync copies, and the checkout's own machine paths.
const OUTSIDE = new Set(['tokens.json', '_technology-groups.md', 'mise.local.toml']);

// The file name a backticked token names without a directory, or null when it names none.
export function fileName(token: string): string | null {
  const candidate = bare(token);
  return FILE_NAME.test(candidate) && !OUTSIDE.has(candidate) ? candidate : null;
}

// Every token of inline code in a markdown document, outside fenced code, with its line.
function codeTokens(markdown: string): { line: number; token: string }[] {
  const tokens: { line: number; token: string }[] = [];
  let inFence = false;
  markdown.split(/\r?\n/).forEach((text, index) => {
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    for (const [, span = ''] of text.matchAll(/`([^`]+)`/g)) {
      for (const token of span.trim().split(/\s+/)) tokens.push({ line: index + 1, token });
    }
  });
  return tokens;
}

// Every backticked repo path in a markdown document, outside fenced code.
export function pathRefs(markdown: string, topLevel: ReadonlySet<string>): PathRef[] {
  return codeTokens(markdown).flatMap(({ line, token }) => {
    const found = repoPath(token, topLevel);
    return found ? [{ line, path: found }] : [];
  });
}

// Every backticked bare file name in a markdown document, outside fenced code.
export function fileNameRefs(markdown: string): PathRef[] {
  return codeTokens(markdown).flatMap(({ line, token }) => {
    const found = fileName(token);
    return found ? [{ line, path: found }] : [];
  });
}

// The npm scripts a line of a doc runs (`npm run <name>`).
export function npmScriptRuns(line: string): string[] {
  return [...line.matchAll(/npm run\s+(?:-s\s+|--silent\s+)?([\w:.-]+)/g)].map(([, name = '']) => name).filter((name) => !name.startsWith('-'));
}

// The tasks a line of a doc runs: `mise run [-c] [-j N] <task>`, the task bare or quoted as a
// glob. A name ends on a word character or `*`, so the punctuation after it is prose; a name
// running on into a `<placeholder>` is an example, not a reference.
export function miseTaskRuns(line: string): string[] {
  return [...line.matchAll(/mise run\s+(?:-[a-zA-Z]\s+(?:\d+\s+)?)*'?([\w:.*-]*[\w*])(?![:.-]*[\w*<])/g)].map(([, name = '']) => name);
}

export interface RepoIndex {
  topLevel: Set<string>;
  tracked: Set<string>;
  // The last segment of every tracked file's path.
  names: Set<string>;
  ignored(paths: readonly string[]): Set<string>;
}

export function repoIndex(root: string): RepoIndex {
  const tracked = new Set<string>();
  const names = new Set<string>();
  for (const file of trackedFiles(root)) {
    const parts = file.split('/');
    for (let i = 1; i <= parts.length; i += 1) tracked.add(parts.slice(0, i).join('/'));
    names.add(parts.at(-1) ?? file);
  }
  const ignored = (paths: readonly string[]): Set<string> => {
    if (paths.length === 0) return new Set();
    const { stdout } = spawnResult('git', ['check-ignore', '--stdin'], { cwd: root, input: `${paths.join('\n')}\n` });
    return new Set(stdout.split('\n').filter(Boolean));
  };
  // Ignored names count even before they exist (dist/ before a build).
  const gitignored = fs
    .readFileSync(path.join(root, '.gitignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim().replace(/^\//, '').replace(/\/$/, ''))
    .filter((name) => /^[\w.-]+$/.test(name));
  const rootEntries = [...new Set([...fs.readdirSync(root), ...gitignored])].filter((name) => name !== '.git');
  // A directory-only pattern (/dist/) matches a missing path only with its slash.
  const ignoredDirs = [...ignored(rootEntries.map((name) => `${name}/`))].map((name) => name.replace(/\/$/, ''));
  const topLevel = new Set([...rootEntries.filter((name) => tracked.has(name)), ...ignored(rootEntries), ...ignoredDirs]);
  return { topLevel, tracked, names, ignored };
}

// The refs that name nothing git tracks or ignores.
export function missingPaths<R extends PathRef>(refs: readonly R[], index: Pick<RepoIndex, 'tracked' | 'ignored'>): R[] {
  const key = (ref: PathRef) => ref.path.replace(/\/+$/, '');
  const untracked = refs.filter((ref) => !index.tracked.has(key(ref)));
  const keys = [...new Set(untracked.map(key))];
  const ignored = index.ignored([...keys, ...keys.map((k) => `${k}/`)]);
  return untracked.filter((ref) => !ignored.has(key(ref)) && !ignored.has(`${key(ref)}/`));
}

// The bare file names no tracked file has.
export function missingNames<R extends PathRef>(refs: readonly R[], index: Pick<RepoIndex, 'names'>): R[] {
  return refs.filter((ref) => !index.names.has(ref.path));
}

// The lines under a heading, up to the next heading of any level, or null without that heading.
export function section(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.replace(/^#+\s+/, '') === heading && /^#+\s/.test(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^#+\s/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

// The names in a table's first column, backticked.
export function tableNames(text: string): Set<string> {
  return new Set([...text.matchAll(/^\|\s*`([^`]+)`/gm)].map(([, name = '']) => name));
}

// The backticked names of the list item that opens with `label`, `h1` to `h6` spelled out.
export function itemNames(text: string, label: string): Set<string> {
  const item = text.split(/\n(?=- )/).find((part) => part.startsWith(`- ${label}`)) ?? '';
  const spelled = item.replace(/`h(\d)` to `h(\d)`/g, (_, from: string, to: string) =>
    Array.from({ length: Number(to) - Number(from) + 1 }, (_, i) => `\`h${Number(from) + i}\``).join(' '),
  );
  return new Set([...spelled.matchAll(/`([^`]+)`/g)].map(([, name = '']) => name));
}

// What a copy lists that its source does not, and what it leaves out.
export function copyDrift(listed: ReadonlySet<string>, source: ReadonlySet<string>): { extra: string[]; missing: string[] } {
  return { extra: [...listed].filter((name) => !source.has(name)), missing: [...source].filter((name) => !listed.has(name)) };
}

// What tests/ARCHITECTURE.md maps: every file a gate runs as a spec or an audit.
const SPEC_AND_AUDIT_FILES = ['tests/audits/check-*.ts', 'tests/unit/*.test.ts', 'tests/playwright/*.spec.ts', 'tests/edge/*.spec.ts'];

interface Copy {
  doc: string;
  heading: string;
  source: string;
  listed(text: string): Set<string>;
  names(): Set<string>;
}

const COPIES: Copy[] = [
  {
    doc: 'docs/Security.md',
    heading: 'HTTP response headers',
    source: "public/_headers' /* rule, and HSTS from cloudflare/zone.json",
    listed: tableNames,
    names: () => {
      const lines = parseHeaders(fs.readFileSync(path.join(siteRoot, 'public/_headers'), 'utf8')).get('/*') ?? [];
      const zone = JSON.parse(fs.readFileSync(path.join(siteRoot, 'cloudflare/zone.json'), 'utf8')) as { hsts?: { enabled?: boolean } };
      const names = lines.map((line) => line.slice(0, line.indexOf(':')));
      return new Set(zone.hsts?.enabled ? [...names, 'Strict-Transport-Security'] : names);
    },
  },
  {
    doc: 'docs/Authoring-Guide.md',
    heading: 'Raw HTML',
    source: 'RAW_HTML_TAGS in src/lib/markdown/guard.ts',
    listed: (text) => itemNames(text, 'Tags:'),
    names: () => new Set(RAW_HTML_TAGS),
  },
  {
    doc: 'tests/ARCHITECTURE.md',
    heading: 'Every spec and audit',
    source: "tests/' spec and audit files",
    listed: tableNames,
    names: () =>
      new Set(trackedFiles(siteRoot, ...SPEC_AND_AUDIT_FILES.map((glob) => `:(glob)${glob}`)).filter((file) => fs.existsSync(path.join(siteRoot, file)))),
  },
];

if (import.meta.main) {
  // The docs are the tracked files the pathspec arguments name (mise.toml's `docs` var), so a
  // gitignored local file or an untracked copy never fails the gate.
  const pathspecs = process.argv.slice(2);
  if (pathspecs.length === 0) abort('check-docs', 'no docs named', 'fix: pass the docs as git pathspecs, as `mise run checks:docs` does');
  const docs = trackedFiles(siteRoot, ...pathspecs).filter((file) => file.endsWith('.md') && fs.existsSync(path.join(siteRoot, file)));
  if (docs.length === 0) abort('check-docs', `no tracked docs match ${pathspecs.join(' ')}`);

  const tasks = miseTasks({ hidden: true });

  const problems: string[] = [];
  const index = repoIndex(siteRoot);
  const allPathRefs: (PathRef & { doc: string })[] = [];
  const allNameRefs: (PathRef & { doc: string })[] = [];
  let taskRefCount = 0;

  for (const doc of docs) {
    const text = fs.readFileSync(path.join(siteRoot, doc), 'utf8');
    allPathRefs.push(...pathRefs(text, index.topLevel).map((ref) => ({ ...ref, doc })));
    allNameRefs.push(...fileNameRefs(text).map((ref) => ({ ...ref, doc })));

    text.split(/\r?\n/).forEach((line, lineIndex) => {
      for (const name of npmScriptRuns(line)) {
        problems.push(`${doc}:${lineIndex + 1}  runs an npm script -> npm run ${name} (package.json has none; every command is \`mise run <task>\`)`);
      }

      for (const name of miseTaskRuns(line)) {
        taskRefCount += 1;
        if (!namesTask(name, tasks)) problems.push(`${doc}:${lineIndex + 1}  unknown mise task -> mise run ${name}`);
      }
    });
  }

  for (const ref of missingPaths(allPathRefs, index)) {
    problems.push(`${ref.doc}:${ref.line}  no such path -> ${ref.path}`);
  }
  for (const ref of missingNames(allNameRefs, index)) {
    problems.push(`${ref.doc}:${ref.line}  no tracked file has this name -> ${ref.path}`);
  }
  for (const copy of COPIES) {
    const text = section(fs.readFileSync(path.join(siteRoot, copy.doc), 'utf8'), copy.heading);
    if (text === null) {
      problems.push(`${copy.doc}  no "${copy.heading}" section, which copies ${copy.source}`);
      continue;
    }
    const { extra, missing } = copyDrift(copy.listed(text), copy.names());
    if (extra.length > 0) problems.push(`${copy.doc} "${copy.heading}"  lists what ${copy.source} lacks -> ${extra.join(', ')}`);
    if (missing.length > 0) problems.push(`${copy.doc} "${copy.heading}"  leaves out what ${copy.source} has -> ${missing.join(', ')}`);
  }

  finish(
    problems,
    `${docs.length} docs, ${taskRefCount} task refs, ${allPathRefs.length} repo paths, ${allNameRefs.length} file names resolve, ${COPIES.length} copied lists match`,
    {
      heading: 'check-docs: documentation references that do not resolve:',
      fix: 'fix: correct the reference at the reported file:line or restore its target, and make a copied list match its source',
    },
  );
}
