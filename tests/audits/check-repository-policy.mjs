#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../../src/lib/site-root.mjs';
import { isConflictCopy, walkFiles } from '../../src/lib/walk.mjs';

const root = siteRoot;
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

// Major.minor must match .nvmrc; patch drift is allowed so a Node security
// patch doesn't block every gate until the pin is bumped.
const expectedNode = read('.nvmrc').trim().replace(/^v/, '');
const actualNode = process.versions.node;
const majorMinor = (version) => version.split('.').slice(0, 2).join('.');
if (majorMinor(actualNode) !== majorMinor(expectedNode)) {
  fail(`Node ${actualNode} does not match .nvmrc (${expectedNode}; major.minor must agree)`);
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
const existingTracked = tracked.filter((file) => fs.existsSync(path.join(root, file)));
const forbiddenTracked = tracked.filter(
  (file) =>
    (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) ||
    (/(^|\/)\.dev\.vars(?:\.|$)/.test(file) && !file.endsWith('.dev.vars.example')) ||
    /(^|\/)(?:dist|playwright-report|test-results)(?:\/|$)/.test(file) ||
    isConflictCopy(path.basename(file)),
);
if (forbiddenTracked.length > 0) {
  fail(`forbidden generated, secret, or conflict files are tracked: ${forbiddenTracked.join(', ')}`);
}

const conflictCopies = [];
for (const base of ['src/content', 'public/assets']) {
  walkFiles(path.join(root, base), {
    skip: (entry, dir) => {
      if (!isConflictCopy(entry.name)) return false;
      conflictCopies.push(path.relative(root, path.join(dir, entry.name)));
      return true;
    },
  });
}
if (conflictCopies.length > 0) {
  fail(`iCloud conflict copies remain: ${conflictCopies.sort().join(', ')}`);
}

// The public stylesheet has one entry and concern-based source modules;
// component-scoped styles would fragment that audited cascade.
const componentStyles = existingTracked.filter(
  (file) => file.startsWith('src/') && file.endsWith('.astro') && /<style(?:\s|>)/.test(read(file)),
);
if (componentStyles.length > 0) {
  fail(`Astro component styles must live in src/styles modules: ${componentStyles.join(', ')}`);
}

// Literal colors are allowed only inside the generated token block. Component
// rules must name a token or derive a variant from one with color-mix().
const styleFiles = existingTracked.filter((file) => file.startsWith('src/styles/') && file.endsWith('.css'));
const authoredStyles = styleFiles
  .map((file) => {
    const stylesheet = read(file);
    // A generated block ends with a `/* <name>:end */` marker (tokens.css,
    // brand.css); strip through the last one so a hand-authored rule below it
    // is still checked, but nothing generated is mistaken for hand-authored.
    const ends = [...stylesheet.matchAll(/\/\* \w+:end \*\//g)];
    const blockEnd = ends.at(-1)?.index;
    return blockEnd !== undefined ? stylesheet.slice(blockEnd) : stylesheet;
  })
  .join('\n');
const literalColor = /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i;
if (literalColor.test(authoredStyles)) {
  fail('src/styles contains a literal color outside the generated token block');
}

// View Transitions are intentionally not part of this site. Keeping lifecycle
// listeners for them adds dead client code and obscures the navigation model.
const transitionHooks = existingTracked.filter(
  (file) => file.startsWith('src/') && /\.(?:astro|[cm]?[jt]sx?)$/.test(file) && read(file).includes('astro:after-swap'),
);
if (transitionHooks.length > 0) {
  fail(`Astro View Transition hooks are not used by this site: ${transitionHooks.join(', ')}`);
}

// Deprecated private-link markers and internal service URLs must never enter
// the public content snapshot or generated site source.
const publicSources = existingTracked.filter(
  (file) => file.startsWith('src/content/') || file.startsWith('src/pages/') || file.startsWith('src/components/'),
);
const sensitivePatterns = [
  { pattern: /title=["']private:/i, label: 'private-link title marker' },
  { pattern: /data-private-tooltip/i, label: 'private tooltip attribute' },
  { pattern: /https:\/\/hq\.jseverino\.com/i, label: 'private HQ hostname' },
];
for (const file of publicSources) {
  const source = read(file);
  for (const { pattern, label } of sensitivePatterns) {
    if (pattern.test(source)) fail(`${file} exposes deprecated ${label}`);
  }
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
  `ok Node ${actualNode}; lockfile aligned; stylesheet architecture clean; no forbidden files or conflict copies; actions pinned`,
);
