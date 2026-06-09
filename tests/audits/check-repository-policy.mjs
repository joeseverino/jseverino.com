#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} exited ${result.status}`);
  }
  return result.stdout.trim();
}

function fail(message) {
  failures.push(message);
}

const expectedNode = read('.nvmrc').trim().replace(/^v/, '');
const actualNode = process.versions.node;
if (actualNode !== expectedNode) {
  fail(`Node ${actualNode} does not match .nvmrc (${expectedNode})`);
}

const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
if (packageLock.name !== packageJson.name) fail('package-lock.json name differs from package.json');
if (packageLock.version !== packageJson.version) {
  fail('package-lock.json version differs from package.json');
}
if (packageLock.packages?.['']?.version !== packageJson.version) {
  fail('package-lock.json root package version differs from package.json');
}
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  if (!isDeepStrictEqual(packageLock.packages?.['']?.[field] ?? {}, packageJson[field] ?? {})) {
    fail(`package-lock.json root ${field} differ from package.json`);
  }
}

const tracked = git(['ls-files']).split('\n').filter(Boolean);
const forbiddenTracked = tracked.filter(
  (file) =>
    (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) ||
    (/(^|\/)\.dev\.vars(?:\.|$)/.test(file) && !file.endsWith('.dev.vars.example')) ||
    /(^|\/)(?:dist|playwright-report|test-results)(?:\/|$)/.test(file) ||
    /(?:^|\/)[^/]+ [0-9]+(?:\.[^/]*)?$/.test(file),
);
if (forbiddenTracked.length > 0) {
  fail(`forbidden generated, secret, or conflict files are tracked: ${forbiddenTracked.join(', ')}`);
}

const conflictCopies = [];
for (const base of ['src/content', 'public/assets']) {
  const absoluteBase = path.join(root, base);
  if (!fs.existsSync(absoluteBase)) continue;

  const pending = [absoluteBase];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (/ [0-9]+(?:\.[^/]*)?$/.test(entry.name)) {
        conflictCopies.push(path.relative(root, absolute));
      }
      if (entry.isDirectory()) pending.push(absolute);
    }
  }
}
if (conflictCopies.length > 0) {
  fail(`iCloud conflict copies remain: ${conflictCopies.sort().join(', ')}`);
}

// Same-basename JS/TS module siblings (e.g. site.mjs + site.ts in one dir)
// resolve ambiguously: Vite/Astro try .mjs before .ts, the TS compiler does the
// reverse. So `astro check` and the bundler disagree and a build can break while
// the typecheck passes. Declaration files (foo.d.ts) keep a distinct stem and are
// unaffected. Forbid the collision outright.
const moduleStems = new Map();
for (const file of tracked) {
  const match = file.match(/^(.*)\.(mjs|cjs|js|jsx|mts|cts|ts|tsx)$/);
  if (!match) continue;
  const [, stem, ext] = match;
  if (!moduleStems.has(stem)) moduleStems.set(stem, new Set());
  moduleStems.get(stem).add(ext);
}
const moduleCollisions = [];
for (const [stem, exts] of moduleStems) {
  const jsLike = ['mjs', 'cjs', 'js', 'jsx'].some((e) => exts.has(e));
  const tsLike = ['mts', 'cts', 'ts', 'tsx'].some((e) => exts.has(e));
  if (jsLike && tsLike) moduleCollisions.push(`${stem}.{${[...exts].sort().join(',')}}`);
}
if (moduleCollisions.length > 0) {
  fail(`same-basename JS/TS modules resolve ambiguously (Vite picks .mjs, tsc picks .ts): ${moduleCollisions.sort().join(', ')}`);
}

for (const file of tracked.filter((name) => name.startsWith('.github/workflows/'))) {
  const source = read(file);
  for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+).*$/gm)) {
    const reference = match[1];
    if (reference.startsWith('./')) continue;
    if (/^docker:\/\/.+@sha256:[0-9a-f]{64}$/.test(reference)) continue;
    if (/^[^@\s]+@[0-9a-f]{40}$/.test(reference)) continue;
    fail(`${file} contains an unpinned action: ${reference}`);
  }
}

if (failures.length > 0) {
  console.error('repository policy failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `ok Node ${actualNode}; lockfile aligned; no forbidden files or conflict copies; actions pinned`,
);
