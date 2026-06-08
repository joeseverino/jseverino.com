#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
