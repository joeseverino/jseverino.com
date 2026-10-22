#!/usr/bin/env node
// Build a baseline ref (in a detached worktree, no stash) and the working tree, then
// report which built files differ. Known varying tokens are normalized.
//
// Usage:
//   node bin/diff-build.ts [baseline-ref]   # default baseline: HEAD
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildOutDir } from '../src/lib/build-output.ts';
import { siteRoot } from '../src/lib/site-root.ts';
import { cli } from './lib/args.ts';
import { spawnResult } from './lib/run.ts';

const [baselineRef = 'HEAD'] = cli({ usage: 'usage: node bin/diff-build.ts [baseline-ref]', allowPositionals: true }).positionals;
const TEXT_EXT = /\.(html|xml|txt|json|css|js)$/;

function run(command: string, args: readonly string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): void {
  const { code } = spawnResult(command, args, {
    cwd,
    stdio: 'inherit',
    env: extraEnv,
  });
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited ${code}`);
}

// Sitemap dates, the site key, and Astro's content hash in bundled file names vary without source changes.
const HASHED_BUNDLE = /(\/_astro\/[^"'\s)]*?)\.[A-Za-z0-9_-]{8}\.(js|css)\b/g;
const HASHED_IMAGE = /(\/_astro\/[^"'\s)]*?)\.[A-Za-z0-9_-]{8}_[A-Za-z0-9]+\.(avif|webp|jpg|png)\b/g;

function normalize(text: string): string {
  return text
    .replace(/<lastmod>[^<]*<\/lastmod>/g, '<lastmod>NORMALIZED</lastmod>')
    .replace(/(data-sitekey=)"[^"]*"/g, '$1"NORMALIZED"')
    .replace(HASHED_BUNDLE, '$1.HASH.$2')
    .replace(HASHED_IMAGE, '$1.HASH.$2');
}

const normalizeName = (name: string): string =>
  name.replace(/\.[A-Za-z0-9_-]{8}\.(js|css)$/, '.HASH.$1').replace(/\.[A-Za-z0-9_-]{8}_[A-Za-z0-9]+\.(avif|webp|jpg|png)$/, '.HASH.$1');

function collect(dir: string): Map<string, string> {
  return new Map(
    fs.readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((file) => TEXT_EXT.test(file))
      .map((file) => [normalizeName(file), normalize(fs.readFileSync(path.join(dir, file), 'utf8'))]),
  );
}

// Writes the normalized text of `files` from a tree under `dir`, so git can diff the two sides.
function writeTree(dir: string, tree: ReadonlyMap<string, string>, files: readonly string[]): void {
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), tree.get(file) ?? '');
  }
}

const buildStatic = (root: string): void => run(process.execPath, [path.join(root, 'bin/build-static.ts')], root);

using scratch = fs.mkdtempDisposableSync(path.join(os.tmpdir(), 'jsev-diffbuild-'));
const worktree = path.join(scratch.path, 'baseline');
const realNodeModules = fs.realpathSync(path.join(siteRoot, 'node_modules'));

try {
  console.log(`Building current working tree...`);
  buildStatic(siteRoot);
  const current = collect(path.join(siteRoot, buildOutDir));

  console.log(`\nBuilding baseline (${baselineRef}) in an isolated worktree...`);
  run('git', ['worktree', 'add', '--detach', worktree, baselineRef], siteRoot);
  fs.symlinkSync(realNodeModules, path.join(worktree, 'node_modules'), 'dir');
  buildStatic(worktree);
  const baseline = collect(path.join(worktree, buildOutDir));

  const onlyBaseline = [...baseline.keys()].filter((f) => !current.has(f)).sort();
  const onlyCurrent = [...current.keys()].filter((f) => !baseline.has(f)).sort();
  const changed = [...current.keys()].filter((f) => baseline.has(f) && baseline.get(f) !== current.get(f)).sort();

  console.log(`\n=== build diff: ${baselineRef} -> working tree ===`);
  console.log(`baseline files: ${baseline.size}  current files: ${current.size}`);

  if (onlyBaseline.length) console.log(`\nremoved (${onlyBaseline.length}):\n  ${onlyBaseline.join('\n  ')}`);
  if (onlyCurrent.length) console.log(`\nadded (${onlyCurrent.length}):\n  ${onlyCurrent.join('\n  ')}`);

  if (changed.length) {
    console.log(`\nchanged (${changed.length}):\n  ${changed.join('\n  ')}\n`);
    using sides = fs.mkdtempDisposableSync(path.join(os.tmpdir(), 'jsev-diffbuild-sides-'));
    writeTree(path.join(sides.path, 'baseline'), baseline, changed);
    writeTree(path.join(sides.path, 'current'), current, changed);
    // Exit 1 means the trees differ, which `changed` already says.
    const { code } = spawnResult('git', ['diff', '--no-index', 'baseline', 'current'], { cwd: sides.path, stdio: 'inherit' });
    if (code !== 0 && code !== 1) throw new Error(`git diff --no-index exited ${code}`);
  }

  if (!onlyBaseline.length && !onlyCurrent.length && !changed.length) {
    console.log('\nNo differences in built output.');
  }
} finally {
  spawnResult('git', ['worktree', 'remove', '--force', worktree], { cwd: siteRoot, stdio: 'ignore' });
}
