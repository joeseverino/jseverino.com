// Engineering docs integrity that no link checker knows: every `mise run` reference names a task,
// no `npm run` names anything but the build (every other command is a mise task), and every
// backticked repo path resolves (git tracks or ignores it). Command refs are checked everywhere,
// fenced code included. Links and #anchors are lychee's
// (`mise run checks:doc-links`).

import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../../src/lib/site-root.ts';
import { abort, finish } from './lib.ts';
import { trackedFiles } from '../../bin/lib/git.ts';
import { spawnResult } from '../../bin/lib/run.ts';
import { miseTasks, namesTask } from '../../bin/lib/mise.ts';

// Backticked paths that are deliberate examples; none names a repo file.
export const EXAMPLE_PATHS: ReadonlySet<string> = new Set([]);

export interface PathRef {
  line: number;
  path: string;
}

const PLACEHOLDER = /[*<>{}$[\]()|"'`?]/;

// The repo path a backticked token names, or null when it names none.
export function repoPath(token: string, topLevel: ReadonlySet<string>): string | null {
  let candidate = token.slice(token.lastIndexOf('=') + 1).replace(/[#?].*$/, '').replace(/:\d+(?:-\d+)?$/, '');
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

// Every backticked repo path in a markdown document, outside fenced code.
export function pathRefs(markdown: string, topLevel: ReadonlySet<string>): PathRef[] {
  const refs: PathRef[] = [];
  let inFence = false;
  markdown.split(/\r?\n/).forEach((text, index) => {
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    for (const [, span = ''] of text.matchAll(/`([^`]+)`/g)) {
      for (const token of span.trim().split(/\s+/)) {
        const found = repoPath(token, topLevel);
        if (found && !EXAMPLE_PATHS.has(found)) refs.push({ line: index + 1, path: found });
      }
    }
  });
  return refs;
}

export interface RepoIndex {
  topLevel: Set<string>;
  tracked: Set<string>;
  ignored(paths: readonly string[]): Set<string>;
}

export function repoIndex(root: string): RepoIndex {
  const tracked = new Set<string>();
  for (const file of trackedFiles(root)) {
    const parts = file.split('/');
    for (let i = 1; i <= parts.length; i += 1) tracked.add(parts.slice(0, i).join('/'));
  }
  const ignored = (paths: readonly string[]): Set<string> => {
    if (paths.length === 0) return new Set();
    const { stdout } = spawnResult('git', ['check-ignore', '--stdin'], { cwd: root, input: `${paths.join('\n')}\n` });
    return new Set(stdout.split('\n').filter(Boolean));
  };
  // Ignored names count even before they exist (dist/ before a build).
  const gitignored = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n')
    .map((line) => line.trim().replace(/^\//, '').replace(/\/$/, ''))
    .filter((name) => /^[\w.-]+$/.test(name));
  const rootEntries = [...new Set([...fs.readdirSync(root), ...gitignored])].filter((name) => name !== '.git');
  // A directory-only pattern (/dist/) matches a missing path only with its slash.
  const ignoredDirs = [...ignored(rootEntries.map((name) => `${name}/`))].map((name) => name.replace(/\/$/, ''));
  const topLevel = new Set([...rootEntries.filter((name) => tracked.has(name)), ...ignored(rootEntries), ...ignoredDirs]);
  return { topLevel, tracked, ignored };
}

// The refs that name nothing git tracks or ignores.
export function missingPaths<R extends PathRef>(refs: readonly R[], index: Pick<RepoIndex, 'tracked' | 'ignored'>): R[] {
  const key = (ref: PathRef) => ref.path.replace(/\/+$/, '');
  const untracked = refs.filter((ref) => !index.tracked.has(key(ref)));
  const keys = [...new Set(untracked.map(key))];
  const ignored = index.ignored([...keys, ...keys.map((k) => `${k}/`)]);
  return untracked.filter((ref) => !ignored.has(key(ref)) && !ignored.has(`${key(ref)}/`));
}

if (import.meta.main) {
  // The docs are the tracked files the pathspec arguments name (mise.toml's `docs` var), so a
  // gitignored local file or an untracked copy never fails the gate.
  const pathspecs = process.argv.slice(2);
  if (pathspecs.length === 0) abort('check-docs', 'no docs named', 'fix: pass the docs as git pathspecs, as `mise run checks:docs` does');
  const docs = trackedFiles(siteRoot, ...pathspecs).filter((file) => file.endsWith('.md') && fs.existsSync(path.join(siteRoot, file)));
  if (docs.length === 0) abort('check-docs', `no tracked docs match ${pathspecs.join(' ')}`);

  const npmRunPattern = /npm run\s+(?:-s\s+|--silent\s+)?([\w:.-]+)/g;
  // `mise run [-c] [-j N] <task>`, the task bare or quoted as a glob; a name ending in a
  // `<placeholder>` is an example, not a reference.
  const miseRunPattern = /mise run\s+(?:-[a-zA-Z]\s+(?:\d+\s+)?)*'?([\w:.*-]+)(?![\w:.*<-])/g;
  const tasks = miseTasks();

  const problems: string[] = [];
  const index = repoIndex(siteRoot);
  const allPathRefs: (PathRef & { doc: string })[] = [];
  let scriptRefCount = 0;

  for (const doc of docs) {
    const text = fs.readFileSync(path.join(siteRoot, doc), 'utf8');
    allPathRefs.push(...pathRefs(text, index.topLevel).map((ref) => ({ ...ref, doc })));

    text.split(/\r?\n/).forEach((line, lineIndex) => {
      for (const [, name = ''] of line.matchAll(npmRunPattern)) {
        if (name.startsWith('-')) continue;
        scriptRefCount += 1;
        if (name !== 'build') problems.push(`${doc}:${lineIndex + 1}  not an npm script -> npm run ${name} (every command but the build is \`mise run <task>\`)`);
      }

      for (const [, name = ''] of line.matchAll(miseRunPattern)) {
        scriptRefCount += 1;
        if (!namesTask(name, tasks)) problems.push(`${doc}:${lineIndex + 1}  unknown mise task -> mise run ${name}`);
      }
    });
  }

  for (const ref of missingPaths(allPathRefs, index)) {
    problems.push(`${ref.doc}:${ref.line}  no such path -> ${ref.path}`);
  }

  finish(problems, `${docs.length} docs, ${scriptRefCount} script and task refs, ${allPathRefs.length} repo paths resolve`, {
    heading: 'check-docs: documentation references that do not resolve:',
    fix: 'fix: correct the reference at the reported file:line, or restore its target; an intentional example path goes in EXAMPLE_PATHS here',
  });
}
