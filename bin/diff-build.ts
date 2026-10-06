#!/usr/bin/env node
// Reproducible before/after build diff: builds a baseline ref and the current
// working tree, then reports which built files differ: did this change alter
// the shipped site? Uses a detached git worktree so the working tree is never
// touched (no stash), and normalizes the two known non-deterministic tokens (the sitemap
// build timestamp and the env-driven Turnstile sitekey) so only real diffs show.
//
// Usage:
//   node bin/diff-build.ts [baseline-ref]   # default baseline: HEAD
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildOutDir } from '../src/lib/build-output.ts';
import { siteRoot } from '../src/lib/site-root.ts';
import { walkFiles } from '../src/lib/walk.ts';
import { cli } from './lib/args.ts';
import { spawnResult } from './lib/run.ts';

const [baselineRef = 'HEAD'] = cli({ usage: 'usage: node bin/diff-build.ts [baseline-ref]', allowPositionals: true }).positionals;
const TEXT_EXT = /\.(html|xml|txt|json|css|js)$/;

function run(command: string, args: readonly string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): void {
  const { code } = spawnResult(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ASTRO_TELEMETRY_DISABLED: '1', ...extraEnv },
  });
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited ${code}`);
}

// Strip the tokens that legitimately vary between builds without any source
// change, so they don't drown out real differences: the sitemap dates, the
// site key, and the content hash Astro puts in every bundled file name (a
// script that changes renames itself, and every page that loads it changes).
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
    walkFiles(dir, { filter: (file) => TEXT_EXT.test(file) })
      .map((file) => [normalizeName(path.relative(dir, file)), normalize(fs.readFileSync(file, 'utf8'))]),
  );
}

function firstDivergence(a: string, b: string) {
  let i = 0;
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i += 1;
  const window = 70;
  return {
    at: i,
    base: a.slice(Math.max(0, i - 25), i + window),
    curr: b.slice(Math.max(0, i - 25), i + window),
  };
}

const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'jsev-diffbuild-'));
const realNodeModules = fs.realpathSync(path.join(siteRoot, 'node_modules'));

try {
  console.log(`Building current working tree...`);
  run(path.join(siteRoot, 'node_modules/.bin/astro'), ['build'], siteRoot);
  const current = collect(path.join(siteRoot, buildOutDir));

  console.log(`\nBuilding baseline (${baselineRef}) in an isolated worktree...`);
  run('git', ['worktree', 'add', '--detach', worktree, baselineRef], siteRoot);
  fs.symlinkSync(realNodeModules, path.join(worktree, 'node_modules'), 'dir');
  run(path.join(siteRoot, 'node_modules/.bin/astro'), ['build'], worktree);
  const baseline = collect(path.join(worktree, buildOutDir));

  const onlyBaseline = [...baseline.keys()].filter((f) => !current.has(f)).sort();
  const onlyCurrent = [...current.keys()].filter((f) => !baseline.has(f)).sort();
  const changed = [...current.keys()].filter((f) => baseline.has(f) && baseline.get(f) !== current.get(f)).sort();

  console.log(`\n=== build diff: ${baselineRef} -> working tree ===`);
  console.log(`baseline files: ${baseline.size}  current files: ${current.size}`);

  if (onlyBaseline.length) console.log(`\nremoved (${onlyBaseline.length}):\n  ${onlyBaseline.join('\n  ')}`);
  if (onlyCurrent.length) console.log(`\nadded (${onlyCurrent.length}):\n  ${onlyCurrent.join('\n  ')}`);

  if (changed.length) {
    console.log(`\nchanged (${changed.length}):`);
    for (const f of changed) {
      const d = firstDivergence(baseline.get(f) ?? '', current.get(f) ?? '');
      console.log(`\n  ${f}  (first diff @ char ${d.at})`);
      console.log(`    baseline: ${JSON.stringify(d.base)}`);
      console.log(`    current : ${JSON.stringify(d.curr)}`);
    }
  }

  if (!onlyBaseline.length && !onlyCurrent.length && !changed.length) {
    console.log('\nNo differences in built output (after normalizing lastmod + sitekey).');
  }
} finally {
  spawnResult('git', ['worktree', 'remove', '--force', worktree], { cwd: siteRoot, stdio: 'ignore' });
  fs.rmSync(worktree, { recursive: true, force: true });
}
