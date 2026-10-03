#!/usr/bin/env node
// `npm run help`: the npm scripts grouped by role. It reads package.json at
// runtime: a removed script drops out, and one not listed below shows under
// "Other" with a nudge to categorize it.
//
// The groups are also the source of the overview tables in docs/Commands.md
// (bin/sync-docs.ts renders them), so each description is written once.
import { styleText } from 'node:util';
import { packageScripts } from '../src/lib/json.ts';

export const GROUPS = [
  {
    title: 'Daily',
    items: {
      'dev': 'Start the local dev server',
      'dev:drafts': 'Dev server including unpublished drafts, from the gitignored overlay (`site dev --drafts`)',
      'site': 'The publishing workflow CLI: `npm run site -- <command>` (validate, publish, land, featured, …)',
      'sync:content': 'Pull published content from the vault into the repo',
      'sync:contract': 'Regenerate typed content-contract projections',
      'sync:contact-openapi': 'Regenerate contact OpenAPI from its request contract',
      'sync:tokens': 'Pull design + brand tokens from `severino-brand` into the repo',
      'sync:edge-site': 'Regenerate the edge runtime\'s copy of the site identity (`functions/generated/site.ts`)',
      'sync:docs': 'Regenerate the generated blocks in `docs/Commands.md` and `tests/ARCHITECTURE.md`',
      'diagnose': 'Run every check and report everything that is wrong',
      'diff:build': 'Build HEAD vs the working tree; show what changed in the shipped site',
    },
  },
  {
    title: 'Release',
    items: {
      'publish:check': 'Fast local build gate (`-- --no-sync` for code-only changes)',
      'publish:check:ci': 'The same gate under CI conditions: `CI=1` + a scratch keyring',
      'release:check': 'Full gate: publish:check + browser/visual/policy + idempotence (macOS)',
      'gate:check': "The registry's fast pre-build audits, collect-all; the first step of CI's `build` job",
      'deploy:verify': 'After the merge deploys, from a residential IP: verify remote CI + the live production deploy',
      'content:diff': 'What a content change means by slug: published, edited, removed, pages, generated (`-- --json`)',
      'audit': '`npm audit` against `.github/audit-allowlist.json`: fails on a high/critical advisory not accepted or past review',
      'build': "Type-check, then produce the static build (what CI's `build` job wraps)",
    },
  },
  {
    title: 'Occasional',
    items: {
      'make:icons': 'Regenerate favicons + brand marks',
      'make:og': 'Regenerate the Open Graph card',
      'make:embed': 'Regenerate `public/embed/bundle.css`, the embeddable stylesheet (brand vars + base.css + inlined Inter)',
      'make:content-index': 'Emit the published-writeup JSON projection consumed by Severino HQ',
      'make:social': 'Regenerate the GitHub social preview',
      'make:font': 'Re-subset the Inter webfont to the site\'s characters and weights (needs python3 + fontTools)',
      'snapshot:github': 'Refresh the committed GitHub repo snapshot, the only source the portfolio Software list reads (a weekly workflow refreshes it)',
      'scaffold:primer': 'Scaffold a new reference primer in the vault',
      'scaffold:writeup-field': 'Add a field once to the canonical writeup contract',
      'draft:cover-alt': 'Draft writeup cover alt text via the Claude API',
      'sign:security': 'Re-sign `public/.well-known/security.txt`',
      'seo:preview': "Preview a page's Google snippet + metadata from built HTML",
      'preview': 'Serve the built site locally',
      'test:unit': 'Unit suite: markdown DSL, Cloudflare functions, gate harness, registry, audit rules',
      'test:e2e': 'Playwright functional specs across Chromium, Firefox, WebKit',
      'test:e2e:ui': 'Playwright in interactive UI mode',
      'test:e2e:visual': 'Visual-regression snapshots (macOS Chromium)',
      'test:e2e:visual:update': 'Re-baseline visual snapshots after an intentional design change',
      'test:edge': 'Serve the build through the Cloudflare runtime and assert headers, CSP nonces, cache rules, and the functions',
      'edge:serve': 'Serve the build through `wrangler pages dev` for by-hand checks (middleware + functions active)',
      'cloudflare:check': 'Diff the live zone and account against `cloudflare/zone.json` (read token; exit 1 on drift)',
      'cloudflare:plan': 'The Cloudflare API calls an apply would make',
      'cloudflare:apply': 'Plan, or with `-- --yes` apply `cloudflare/zone.json` (edit token; owned rules only)',
      'd1:apply': 'Apply `cloudflare/d1.sql` to the remote D1 database (idempotent)',
      'check:lighthouse': 'Lighthouse against the live site with the URLs and thresholds in `tests/lighthouserc.json` (needs Chrome; CI runs it weekly)',
      'clean:generated': 'Remove build output and build caches',
    },
  },
  {
    title: 'Internal (run by the commands above)',
    items: {
      'check': 'CSS lint + unused-var audit + `astro check` (used by `build`)',
      'build:static': '`astro build` + sitedrift wrap (used by `build` and the gates)',
      'lint:css': 'Stylelint over `src/styles/`',
      'check:security': 'security.txt signature, required fields, expiry, WKD file',
      'check:contrast': 'WCAG ratios for every text/background pair in `base.css`',
      'check:parity': 'The content contract, the Astro schema, the writeup store, and the `site manage` TUI agree on writeup fields',
      typecheck: 'Strict TypeScript over the whole repo (Node program, then the Workers program for `functions/`)',
      'check:edge': 'Contact handler, OpenAPI schema, and D1 schema agree',
      'check:preview': 'Sitedrift wrapping on previews, absent on main',
      'check:docs': 'Every doc link and anchor, `npm run` reference, and backticked repo path resolves',
      'check:css-vars': 'No CSS custom property is defined but never used',
      'check:links': 'Every internal reference in the built site resolves',
      'check:weight': 'Per-page HTML and total CSS/JS stay inside their byte budgets',
      'check:html': 'No duplicate ids; every image carries alt; no unprocessed `::directive`',
      'check:seo': 'Title, canonical, og:title, og:image, valid JSON-LD on every page',
      'check:routes': '`_routes.json` keeps assets out of Functions and every HTML page and Function route in',
      'check:repo-policy': 'Node pin, lockfile alignment, clean tree, TypeScript only, SHA-pinned Actions',
      'audit:assets': 'Image count + weight report (the gates run it strict)',
      'help': 'Print the live grouped list of all of the above',
    },
  },
];

// The groups with only the scripts package.json actually defines.
type Scripts = Record<string, string>;

export function groupedScripts(scripts: Scripts): { title: string; rows: [string, string][] }[] {
  return GROUPS.map((group) => ({
    title: group.title,
    rows: Object.entries(group.items).filter(([name]) => scripts[name]),
  })).filter((group) => group.rows.length > 0);
}

function uncategorizedScripts(scripts: Scripts): string[] {
  const known = new Set(GROUPS.flatMap((group) => Object.keys(group.items)));
  return Object.keys(scripts).filter((name) => !known.has(name));
}

if (import.meta.main) {
  const scripts = packageScripts();
  const pad = Math.max(...Object.keys(scripts).map((name) => name.length)) + 2;
  const bold = (text: string) => styleText('bold', text);
  const dim = (text: string) => styleText('dim', text);
  const cyan = (text: string) => styleText('cyan', text);

  console.log(`\n${bold('npm scripts')} ${dim('(run any with:  npm run <name>)')}\n`);

  for (const group of groupedScripts(scripts)) {
    console.log(bold(group.title));
    for (const [name, desc] of group.rows) console.log(`  ${cyan(name.padEnd(pad))} ${desc}`);
    console.log('');
  }

  const uncategorized = uncategorizedScripts(scripts);
  if (uncategorized.length > 0) {
    console.log(bold('Other (uncategorized: add to bin/help.ts)'));
    for (const name of uncategorized) console.log(`  ${cyan(name.padEnd(pad))} ${dim(scripts[name] ?? '')}`);
    console.log('');
  }
}
