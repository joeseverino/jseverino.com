#!/usr/bin/env node
// `npm run help` — a grouped, role-labeled view of the npm scripts so finding
// the right one never means scanning a flat list. It reads package.json at runtime,
// so it can't go stale: a script removed from package.json drops out here, and a
// new one that isn't curated below still shows under "Other" (with a nudge to
// categorize it) — nothing is ever hidden.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const GROUPS = [
  {
    title: 'Daily — the everyday workflow',
    items: {
      'dev': 'Start the local dev server',
      'dev:drafts': 'Dev server including unpublished drafts',
      'sync:content': 'Pull published content from the vault into the repo',
      'diagnose': 'Run every check and report what is wrong — the "is it okay?" button',
      'diff:build': 'Build HEAD vs the working tree; show what changed in the shipped site',
    },
  },
  {
    title: 'Release',
    items: {
      'publish:check': 'Fast local build gate (add `-- --no-sync` for code-only changes)',
      'publish:check:ci': 'Rehearse the CI gate: CI=1 + scratch keyring, before pushing workflow-affecting changes',
      'release:check': 'Full gate: publish:check + browser/visual/policy + idempotence (macOS)',
      'deploy:verify': 'After pushing: verify remote CI + the live production deploy',
      'build': 'Type-check, then produce the static build',
    },
  },
  {
    title: 'Occasional — run when the specific need comes up',
    items: {
      'make:icons': 'Regenerate favicons + brand marks',
      'make:og': 'Regenerate the Open Graph card',
      'make:social': 'Regenerate the GitHub social preview',
      'scaffold:primer': 'Scaffold a new reference primer',
      'scaffold:writeup-field': 'Add a writeup frontmatter field across every layer',
      'draft:cover-alt': 'Draft writeup cover alt text via the Claude API',
      'sign:security': 'Re-sign public/.well-known/security.txt',
      'seo:preview': 'Preview a page Google snippet + metadata from built HTML',
      'preview': 'Serve the built site locally',
      'test:unit': 'Unit-test the markdown DSL (gates run it too via the registry)',
      'test:e2e': 'Run Playwright functional specs',
      'test:e2e:ui': 'Playwright in interactive UI mode',
      'test:e2e:visual': 'Run visual-regression snapshots',
      'test:e2e:visual:update': 'Re-baseline visual snapshots after an intentional design change',
      'clean:generated': 'Remove build output + caches',
      'clean:conflicts': 'Resolve iCloud conflict copies',
    },
  },
  {
    title: 'Internal — run by the commands above; rarely typed directly',
    items: {
      'check': 'Used by build — CSS lint + unused-var + astro type/content check',
      'build:static': 'Used by build — astro build + sitedrift wrap',
      'lint:css': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'check:css': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'check:security': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'check:contrast': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'check:parity': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'check:preview': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'check:docs': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'check:types': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'check:edge': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'check:html': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'check:links': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'check:weight': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'check:seo': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'check:repo': 'Individual audit (gates run it via tests/audits/registry.mjs)',
      'audit:assets': 'Individual audit (gates run it via tests/audits/registry.mjs)',
    },
  },
];

const known = new Set(GROUPS.flatMap((g) => Object.keys(g.items)).concat('help'));
const uncategorized = Object.keys(scripts).filter((s) => !known.has(s));
const pad = Math.max(...Object.keys(scripts).map((s) => s.length)) + 2;

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

console.log(`\n${bold('npm scripts')} ${dim('— run any with:  npm run <name>')}\n`);

for (const group of GROUPS) {
  const rows = Object.entries(group.items).filter(([name]) => scripts[name]);
  if (rows.length === 0) continue;
  console.log(bold(group.title));
  for (const [name, desc] of rows) console.log(`  ${cyan(name.padEnd(pad))} ${desc}`);
  console.log('');
}

if (uncategorized.length > 0) {
  console.log(bold('Other (uncategorized — add to bin/help.mjs)'));
  for (const name of uncategorized) console.log(`  ${cyan(name.padEnd(pad))} ${dim(scripts[name])}`);
  console.log('');
}
