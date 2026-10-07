#!/usr/bin/env node
// Engineering docs integrity: every relative link, image, `npm run` reference, backticked repo
// path and #fragment resolves. src/content is excluded; fenced code is skipped for links;
// `npm run` refs are checked everywhere. Backticked paths resolve if git tracks or ignores them.

import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../../src/lib/site-root.ts';
import { walkFiles } from '../../src/lib/walk.ts';
import { packageScripts } from '../../src/lib/json.ts';
import { finish } from './lib.ts';
import { isExternal } from '../../src/lib/refs.ts';
import { trackedFiles } from '../../bin/lib/git.ts';
import { spawnResult } from '../../bin/lib/run.ts';

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

// GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens,
// repeats suffixed -1, -2. Explicit id="…" and name="…" anchors count too.
export function anchors(markdown: string): Set<string> {
  const found = new Set<string>();
  const seen = new Map<string, number>();
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const [, id = ''] of line.matchAll(/\s(?:id|name)="([^"]+)"/g)) found.add(id);
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const text = (heading[1] ?? '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[<>]/g, '');
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    found.add(count === 0 ? base : `${base}-${count}`);
  }
  return found;
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
  const scripts = packageScripts();
  const walk = (dir: string): string[] =>
    walkFiles(path.join(siteRoot, dir), { filter: (file) => file.endsWith('.md') })
      .map((file) => path.relative(siteRoot, file));
  const rootDocs = ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'AGENTS.md'].filter((file) =>
    fs.existsSync(path.join(siteRoot, file)),
  );
  const docs = [...rootDocs, ...walk('docs'), ...walk('tests')];

  const linkPattern = /(?:!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\))|(?:<img[^>]+src="([^"]+)")/g;
  const npmRunPattern = /npm run\s+(?:-s\s+|--silent\s+)?([\w:.-]+)/g;

  const problems: string[] = [];
  const index = repoIndex(siteRoot);
  const allPathRefs: (PathRef & { doc: string })[] = [];
  const anchorCache = new Map<string, Set<string>>();
  const anchorsOf = (file: string): Set<string> => {
    let set = anchorCache.get(file);
    if (!set) anchorCache.set(file, (set = anchors(fs.readFileSync(file, 'utf8'))));
    return set;
  };
  let linkCount = 0;
  let scriptRefCount = 0;

  for (const doc of docs) {
    const docDir = path.dirname(path.join(siteRoot, doc));
    const text = fs.readFileSync(path.join(siteRoot, doc), 'utf8');
    allPathRefs.push(...pathRefs(text, index.topLevel).map((ref) => ({ ...ref, doc })));
    let inFence = false;

    text.split(/\r?\n/).forEach((line, lineIndex) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return;
      }

      if (!inFence) {
        // Blank inline code spans so example links in prose are not real references.
        const lineForLinks = line.replace(/`[^`]*`/g, '');
        for (const match of lineForLinks.matchAll(linkPattern)) {
          const raw = match[1] ?? match[2];
          if (!raw || (!raw.startsWith('#') && isExternal(raw))) continue;
          const [beforeHash = '', fragment] = raw.split('#');
          const target = beforeHash.split('?')[0] ?? '';
          const file = target ? path.resolve(docDir, target) : path.join(siteRoot, doc);
          linkCount += 1;
          if (target && !fs.existsSync(file)) {
            problems.push(`${doc}:${lineIndex + 1}  broken link -> ${raw}`);
          } else if (fragment && file.endsWith('.md') && !anchorsOf(file).has(decodeURIComponent(fragment))) {
            problems.push(`${doc}:${lineIndex + 1}  no such anchor -> ${raw}`);
          }
        }
      }

      for (const match of line.matchAll(npmRunPattern)) {
        const name = match[1] ?? '';
        if (name.startsWith('-')) continue;
        scriptRefCount += 1;
        if (!scripts[name]) {
          problems.push(`${doc}:${lineIndex + 1}  unknown npm script -> npm run ${name}`);
        }
      }
    });
  }

  for (const ref of missingPaths(allPathRefs, index)) {
    problems.push(`${ref.doc}:${ref.line}  no such path -> ${ref.path}`);
  }

  finish(problems, `${docs.length} docs, ${linkCount} local links, ${scriptRefCount} script refs, ${allPathRefs.length} repo paths resolve`, {
    heading: 'check-docs: documentation references that do not resolve:',
  });
}
