#!/usr/bin/env node
// `npm run help` — a grouped, role-labeled view of the npm scripts so finding
// the right one never means scanning a flat list. It reads package.json at runtime,
// so it can't go stale: a script removed from package.json drops out here, and a
// new one that isn't curated below still shows under "Other" (with a nudge to
// categorize it) — nothing is ever hidden.
//
// The groups are also the source of the overview tables in docs/Commands.md
// (bin/sync-docs.mjs renders them), so each description is written once.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { siteRoot } from '../src/lib/site-root.mjs';
import { COLOR } from './lib/run.mjs';

export const GROUPS = [
  {
    title: 'Daily — the everyday workflow',
    items: {
      'dev': 'Start the local dev server',
      'dev:drafts': 'Dev server including unpublished drafts',
      'sync:content': 'Pull published content from the vault into the repo',
      'sync:contract': 'Regenerate typed content-contract projections',
      'sync:contact-openapi': 'Regenerate contact OpenAPI from its request contract',
      'sync:tokens': 'Pull design + brand tokens from `severino-brand` into the repo',
      'sync:edge-site': 'Regenerate the edge runtime\'s copy of the site identity (`functions/generated/site.ts`)',
      'sync:docs': 'Regenerate the generated blocks in `docs/Commands.md` and `tests/ARCHITECTURE.md`',
      'diagnose': 'Run every check and report what is wrong — the "is it okay?" button',
      'diff:build': 'Build HEAD vs the working tree; show what changed in the shipped site',
    },
  },
  {
    title: 'Release',
    items: {
      'publish:check': 'Fast local build gate (`-- --no-sync` for code-only changes)',
      'publish:check:ci': 'The same gate under CI conditions: `CI=1` + a scratch keyring',
      'release:check': 'Full gate: publish:check + browser/visual/policy + idempotence (macOS)',
      'gate:check': "CI's first job: the registry's fast pre-build audits, collect-all, before build, e2e, and visual start",
      'deploy:verify': 'After pushing, from a residential IP: verify remote CI + the live production deploy',
      'build': "Type-check, then produce the static build (what CI's `build` job wraps)",
    },
  },
  {
    title: 'Occasional — run when the specific need comes up',
    items: {
      'make:icons': 'Regenerate favicons + brand marks',
      'make:og': 'Regenerate the Open Graph card',
      'make:embed': 'Regenerate `public/embed/bundle.css` — the one embeddable stylesheet (brand vars + base.css + inlined Inter)',
      'make:content-index': 'Emit the published-writeup JSON projection consumed by Severino HQ',
      'make:social': 'Regenerate the GitHub social preview',
      'make:font': 'Re-subset the Inter webfont to the site\'s characters and weights (needs python3 + fontTools)',
      'snapshot:github': 'Refresh the committed GitHub repo snapshot the portfolio Software list falls back to',
      'scaffold:primer': 'Scaffold a new reference primer in the vault',
      'scaffold:writeup-field': 'Add a field once to the canonical writeup contract',
      'draft:cover-alt': 'Draft writeup cover alt text via the Claude API',
      'sign:security': 'Re-sign `public/.well-known/security.txt`',
      'seo:preview': "Preview a page's Google snippet + metadata from built HTML",
      'preview': 'Serve the built site locally',
      'test:unit': 'Unit suite: markdown DSL, Cloudflare functions, gate harness, registry',
      'test:e2e': 'Playwright functional specs across Chromium, Firefox, WebKit',
      'test:e2e:ui': 'Playwright in interactive UI mode',
      'test:e2e:visual': 'Visual-regression snapshots (macOS Chromium)',
      'test:e2e:visual:update': 'Re-baseline visual snapshots after an intentional design change',
      'test:edge': 'Serve the build through the Cloudflare runtime and assert headers, CSP nonces, cache rules, and the functions',
      'edge:serve': 'Serve the build through `wrangler pages dev` for by-hand checks (middleware + functions active)',
      'check:lighthouse': 'Lighthouse against the live site with the URLs and thresholds in `.lighthouserc.json` (needs Chrome; CI runs it weekly)',
      'clean:generated': 'Remove build output + caches, then resolve conflict copies',
      'clean:conflicts': 'Resolve iCloud conflict copies only',
    },
  },
  {
    title: 'Internal — run by the commands above; rarely typed directly',
    items: {
      'check': 'CSS lint + unused-var audit + `astro check` (used by `build`)',
      'build:static': '`astro build` + sitedrift wrap (used by `build` and the gates)',
      'lint:css': 'Stylelint over `src/styles/`',
      'check:security': 'security.txt signature, required fields, expiry, WKD file',
      'check:tokens': 'Committed brand projections match the lockfile-pinned upstream contract',
      'check:contrast': 'WCAG ratios for every text/background pair in `base.css`',
      'check:parity': 'Vault schema, Zod config, MCP server, and the `site manage` TUI agree on writeup fields',
      'check:types': 'Strict TypeScript over `functions/`',
      'check:edge': 'Contact handler, OpenAPI schema, and D1 schema agree',
      'check:preview': 'Sitedrift wrapping on previews, absent on main',
      'check:docs': 'Every doc link and `npm run` reference resolves',
      'check:css-vars': 'No CSS custom property is defined but never used',
      'check:links': 'Every internal reference in the built site resolves',
      'check:weight': 'Per-page HTML and total CSS/JS stay inside their byte budgets',
      'check:html': 'No duplicate ids; every image carries alt',
      'check:embed': '`public/embed/bundle.css` matches its sources (regenerate with `make:embed`)',
      'check:seo': 'Title, canonical, og:title, og:image, valid JSON-LD on every page',
      'check:repo-policy': 'Node pin, lockfile alignment, clean tree, SHA-pinned Actions',
      'audit:assets': 'Image count + weight report (the gates run it strict)',
      'help': 'Print the live grouped list of all of the above',
    },
  },
];

// The groups with only the scripts package.json actually defines.
export function groupedScripts(scripts) {
  return GROUPS.map((group) => ({
    title: group.title,
    rows: Object.entries(group.items).filter(([name]) => scripts[name]),
  })).filter((group) => group.rows.length > 0);
}

export function uncategorizedScripts(scripts) {
  const known = new Set(GROUPS.flatMap((group) => Object.keys(group.items)));
  return Object.keys(scripts).filter((name) => !known.has(name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(siteRoot, 'package.json'), 'utf8'));
  const pad = Math.max(...Object.keys(scripts).map((name) => name.length)) + 2;
  const { bold, dim, cyan } = COLOR;

  console.log(`\n${bold('npm scripts')} ${dim('— run any with:  npm run <name>')}\n`);

  for (const group of groupedScripts(scripts)) {
    console.log(bold(group.title));
    for (const [name, desc] of group.rows) console.log(`  ${cyan(name.padEnd(pad))} ${desc}`);
    console.log('');
  }

  const uncategorized = uncategorizedScripts(scripts);
  if (uncategorized.length > 0) {
    console.log(bold('Other (uncategorized — add to bin/help.mjs)'));
    for (const name of uncategorized) console.log(`  ${cyan(name.padEnd(pad))} ${dim(scripts[name])}`);
    console.log('');
  }
}
