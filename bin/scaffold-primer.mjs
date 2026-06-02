#!/usr/bin/env node
// Scaffold a new reference primer under <vault>/04 Reference/.
//
// Usage:
//   node bin/scaffold-primer.mjs "Astro Content Layer" --tags astro,content
//   node bin/scaffold-primer.mjs --title "X primer" --tags y,z --vault /abs/path
//
// Writes a slim-frontmatter primer the MCP indexer auto-picks up as
// ref-<kebab-stem>.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);

function flag(name, fallback) {
  const i = args.findIndex((a) => a === `--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

function positional(index) {
  const rest = args.filter((a) => !a.startsWith('--'));
  return rest[index];
}

function fail(message) {
  console.error(`scaffold-primer: ${message}`);
  process.exit(1);
}

const title = flag('title', positional(0));
if (!title) fail('title required (positional or --title)');

const tagsRaw = flag('tags', positional(1)) ?? '';
const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);

const vault =
  flag('vault') ??
  process.env.VAULT_DIR ??
  path.resolve(process.cwd(), '../../Severino Labs');
if (!fs.existsSync(vault)) fail(`vault not found: ${vault}`);

const referenceDir = path.join(vault, '04 Reference');
if (!fs.existsSync(referenceDir)) fail(`reference dir not found: ${referenceDir}`);

const filename = title.endsWith('primer') ? `${title}.md` : `${title} primer.md`;
const target = path.join(referenceDir, filename);
if (fs.existsSync(target)) fail(`already exists: ${target}`);

const today = new Date().toISOString().slice(0, 10);
const tagsYaml = tags.length > 0 ? `[${tags.join(', ')}]` : '[]';

const body = `---
type: reference
tags: ${tagsYaml}
created: ${today}
---

# ${title}

## What it is

<!-- One-paragraph definition. -->

## How it works

<!-- Plain-language description of the mechanism. -->

## How it shows up in your stack

<!-- Concrete references to your repo + workflows. -->

## What it doesn't do

<!-- Common misconceptions. -->

## Related

- [[GitHub Actions primer]]
`;

fs.writeFileSync(target, body);
console.log(`created: ${path.relative(process.cwd(), target)}`);
console.log(`indexable as: ref-${path.basename(target, '.md').toLowerCase().replace(/[ _]+/g, '-')}`);
