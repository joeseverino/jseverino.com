#!/usr/bin/env node
// Internal documentation integrity. Asserts that every relative link, image,
// and `npm run <script>` reference in the engineering docs points at something
// that actually exists. Catches the drift that creeps in when a file is renamed
// or a script is removed but a doc still points at the old name.
//
// Scope is the engineering docs only (README, SECURITY, docs/, tests/*.md, and
// AGENTS.md when present). Site content under src/content is excluded: it links
// to live routes and external URLs, not repo files.
//
// Links inside fenced code blocks are treated as example syntax and skipped.
// `npm run` references are validated everywhere, since command blocks are real.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const scripts = JSON.parse(fs.readFileSync(path.join(siteRoot, 'package.json'), 'utf8')).scripts ?? {};

// iCloud conflict copies ("README 2.md") are transient cruft, never real docs.
const conflictCopy = / \d+(\.[^.]+)?$/;

function walk(dir, files = []) {
  const abs = path.join(siteRoot, dir);
  if (!fs.existsSync(abs)) return files;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (conflictCopy.test(entry.name)) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, files);
    else if (entry.name.endsWith('.md')) files.push(rel);
  }
  return files;
}

const rootDocs = ['README.md', 'SECURITY.md', 'AGENTS.md'].filter((file) =>
  fs.existsSync(path.join(siteRoot, file)),
);
const docs = [...rootDocs, ...walk('docs'), ...walk('tests')];

const linkPattern = /(?:!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\))|(?:<img[^>]+src="([^"]+)")/g;
const npmRunPattern = /npm run\s+(?:-s\s+|--silent\s+)?([\w:.-]+)/g;

function isExternal(target) {
  return /^(?:https?:|mailto:|tel:|#|\/\/|\/)/.test(target);
}

const problems = [];
let linkCount = 0;
let scriptRefCount = 0;

for (const doc of docs) {
  const docDir = path.dirname(path.join(siteRoot, doc));
  const lines = fs.readFileSync(path.join(siteRoot, doc), 'utf8').split(/\r?\n/);
  let inFence = false;

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }

    if (!inFence) {
      // Blank inline code spans so example links like `![alt](./x.png)` in prose
      // are not mistaken for real references. npm run refs below use the raw line.
      const lineForLinks = line.replace(/`[^`]*`/g, '');
      for (const match of lineForLinks.matchAll(linkPattern)) {
        const raw = match[1] ?? match[2];
        if (!raw || isExternal(raw)) continue;
        const target = raw.split('#')[0].split('?')[0];
        if (!target) continue; // pure in-page anchor
        linkCount += 1;
        if (!fs.existsSync(path.resolve(docDir, target))) {
          problems.push(`${doc}:${index + 1}  broken link -> ${raw}`);
        }
      }
    }

    for (const match of line.matchAll(npmRunPattern)) {
      const name = match[1];
      if (name.startsWith('-')) continue;
      scriptRefCount += 1;
      if (!scripts[name]) {
        problems.push(`${doc}:${index + 1}  unknown npm script -> npm run ${name}`);
      }
    }
  });
}

if (problems.length > 0) {
  console.error('check-docs: documentation references that do not resolve:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(
  `ok       ${docs.length} docs, ${linkCount} local links, ${scriptRefCount} script refs resolve`,
);
