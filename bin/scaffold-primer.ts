#!/usr/bin/env node
// Scaffold a new reference primer under <vault>/04 Reference/.
//
// Usage:
//   node bin/scaffold-primer.ts "Astro Content Layer" --tags astro,content
//   node bin/scaffold-primer.ts --title "X primer" --tags y,z --vault /abs/path
//
// Writes a slim-frontmatter primer the MCP indexer auto-picks up as
// ref-<kebab-stem>.

import fs from 'node:fs';
import path from 'node:path';
import { cli } from './lib/args.ts';
import { vaultRoot as vaultRootFor } from './lib/local-paths.ts';
import { isoDate } from '../src/lib/dates.ts';

const { values, positionals } = cli({
  usage: 'usage: node bin/scaffold-primer.ts <title> [tags] [--title <title>] [--tags a,b] [--vault <path>]',
  options: { title: { type: 'string' }, tags: { type: 'string' }, vault: { type: 'string' } },
  allowPositionals: true,
});

function fail(message: string): never {
  console.error(`scaffold-primer: ${message}`);
  process.exit(1);
}

const title = values.title ?? positionals[0];
if (!title) fail('title required (positional or --title)');

const tagsRaw = values.tags ?? positionals[1] ?? '';
const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);

const vault = values.vault ?? vaultRootFor();
if (!fs.existsSync(vault)) fail(`vault not found: ${vault}`);

const referenceDir = path.join(vault, '04 Reference');
if (!fs.existsSync(referenceDir)) fail(`reference dir not found: ${referenceDir}`);

const filename = title.endsWith('primer') ? `${title}.md` : `${title} primer.md`;
const target = path.join(referenceDir, filename);
if (fs.existsSync(target)) fail(`already exists: ${target}`);

const today = isoDate();
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
