#!/usr/bin/env node
// Reproducible before/after build diff: builds a baseline ref and the current
// working tree, then reports which built files differ. Answers "did this change
// actually alter the shipped site?" — the core promise of a reviewable static
// artifact. Uses a detached git worktree so the working tree is never touched
// (no stash), and normalizes the two known non-deterministic tokens (the sitemap
// build timestamp and the env-driven Turnstile sitekey) so only real diffs show.
//
// Usage:
//   node bin/diff-build.mjs [baseline-ref]   # default baseline: HEAD
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOutDir } from '../src/lib/build-output.mjs';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineRef = process.argv[2] || 'HEAD';
const TEXT_EXT = /\.(html|xml|txt|json|css|js)$/;

function run(command, args, cwd, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', SOURCE_DATE_EPOCH: '1700000000', ...extraEnv },
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
}

// Strip the two tokens that legitimately vary between builds without any source
// change, so they don't drown out real differences.
function normalize(text) {
  return text
    .replace(/<lastmod>[^<]*<\/lastmod>/g, '<lastmod>NORMALIZED</lastmod>')
    .replace(/(data-sitekey=)"[^"]*"/g, '$1"NORMALIZED"');
}

function collect(dir) {
  const files = new Map();
  const walk = (current) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (TEXT_EXT.test(entry.name)) files.set(path.relative(dir, full), normalize(fs.readFileSync(full, 'utf8')));
    }
  };
  walk(dir);
  return files;
}

function firstDivergence(a, b) {
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
  const current = collect(path.join(siteRoot, buildOutDir()));

  console.log(`\nBuilding baseline (${baselineRef}) in an isolated worktree...`);
  run('git', ['worktree', 'add', '--detach', worktree, baselineRef], siteRoot);
  fs.symlinkSync(realNodeModules, path.join(worktree, 'node_modules'), 'dir');
  run(path.join(siteRoot, 'node_modules/.bin/astro'), ['build'], worktree);
  const baseline = collect(path.join(worktree, buildOutDir()));

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
      const d = firstDivergence(baseline.get(f), current.get(f));
      console.log(`\n  ${f}  (first diff @ char ${d.at})`);
      console.log(`    baseline: ${JSON.stringify(d.base)}`);
      console.log(`    current : ${JSON.stringify(d.curr)}`);
    }
  }

  if (!onlyBaseline.length && !onlyCurrent.length && !changed.length) {
    console.log('\nNo differences in built output (after normalizing lastmod + sitekey).');
  }
} finally {
  spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: siteRoot, stdio: 'ignore' });
  fs.rmSync(worktree, { recursive: true, force: true });
}
