#!/usr/bin/env node
// The site owns one machine-readable content contract; the Astro schema, the
// public projection, the writeup store, and the manage TUI all derive from it.

import fs from 'node:fs';
import path from 'node:path';
import { siteRoot as root } from '../../src/lib/site-root.ts';
import {
  contentContract,
  contentContractFingerprint,
} from '../../src/lib/content-contract.ts';
import { abort } from './lib.ts';

const fail: (message: string) => never = (message) => abort('check-contract-parity', message);

const writeupFields = contentContract.collections?.writeups?.fields;
if (!writeupFields || Object.keys(writeupFields).length === 0) {
  fail('canonical writeup contract has no fields');
}

const contentConfig = fs.readFileSync(path.join(root, 'src/content.config.ts'), 'utf8');
const syncSource = fs.readFileSync(path.join(root, 'bin/content-sync/sync.ts'), 'utf8');
const generatedSchema = fs.readFileSync(path.join(root, 'src/generated/content-schema.ts'), 'utf8');
const publicProjection = fs.readFileSync(path.join(root, 'bin/content-sync/public-projection.ts'), 'utf8');
if (!contentConfig.includes("from './generated/content-schema.ts'")) {
  fail('Astro writeup schema does not derive from the canonical contract');
}
if (!generatedSchema.includes(`Contract fingerprint: ${contentContractFingerprint()}`)) {
  fail('generated Astro schema fingerprint is stale; run npm run sync:contract');
}
if (!syncSource.includes('projection.writeup(') || !publicProjection.includes("projectFrontmatter('writeups'")) {
  fail('public writeup projection does not derive from the canonical contract');
}

const store = fs.readFileSync(path.join(root, 'bin/lib/writeups/store.ts'), 'utf8');
if (!store.includes("collectionFields('writeups')")) {
  fail('the writeup store does not read its editable fields from the content contract');
}

const tui = fs.readFileSync(path.join(root, 'bin/site/manage-model.ts'), 'utf8');
if (!tui.includes("collectionFields('writeups')")) {
  fail('site manage does not read its fields from the content contract');
}
if (/const FIELDS\s*=\s*\[/.test(tui)) {
  fail('site manage hardcodes its field registry');
}

console.log(
  `ok       one content contract drives Astro/public/store/CLI/TUI (${contentContractFingerprint().slice(0, 12)})`,
);
