#!/usr/bin/env node
// `npm run help`: npm scripts grouped by role, filtered against package.json.
// Unlisted scripts show under "Other". The groups also feed docs/Commands.md
// (rendered by bin/sync-docs.ts). The gates are mise tasks: `mise tasks`.
import { styleText } from 'node:util';
import { packageScripts } from '../src/lib/json.ts';

export const GROUPS = [
  {
    title: 'Daily',
    items: {
      'dev': 'Start the local dev server',
      'site': 'The publishing workflow CLI: `npm run site -- <command>` (validate, publish, land, featured, …)',
      'sync:content': 'Pull published content from the vault into the repo',
      'sync:contract': 'Regenerate typed content-contract projections',
      'sync:contact-openapi': 'Regenerate contact OpenAPI from its request contract',
      'sync:tokens': 'Pull design + brand tokens from `severino-brand` into the repo',
      'sync:edge-site': 'Regenerate the edge runtime\'s copy of the site identity (`functions/generated/site.ts`)',
      'sync:docs': 'Regenerate the generated blocks in `docs/Commands.md` (these scripts and the mise tasks)',
      'diff:build': 'Build HEAD vs the working tree; show what changed in the shipped site',
      'help': 'Print this list grouped by role; `mise tasks` lists the gates',
    },
  },
  {
    title: 'Release',
    items: {
      'deploy:verify': 'After the merge deploys, from a residential IP: verify remote CI + the live production deploy',
      'diff:content': 'What a content change means by slug: published, edited, removed, pages, generated (`-- --json`)',
      'audit': '`npm audit` against `.github/audit-allowlist.json`: fails on a high/critical advisory not accepted or past review',
      'build': "The production build: astro build, the sitedrift wrap, the CSP hashes (Cloudflare Pages' build command)",
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
      'snapshot:github': 'Refresh the committed GitHub repo snapshot, the only source the portfolio Software list reads for repos',
      'snapshot:software': 'Refresh the committed PyPI/npm snapshot (versions, monthly downloads); fails without writing if any lookup fails',
      'scaffold:writeup-field': 'Add a field once to the canonical writeup contract',
      'draft:cover-alt': 'Draft writeup cover alt text via the Claude API',
      'sign:security': 'Re-sign `public/.well-known/security.txt`',
      'preview:seo': "Preview a page's Google snippet + metadata from built HTML",
      'preview': 'Serve the built site locally',
      'serve:edge': 'Serve the build through `wrangler pages dev` for by-hand checks (headers + functions active)',
      'cloudflare:check': 'Diff the live zone and account against `cloudflare/zone.json` (read token; exit 1 on drift)',
      'cloudflare:plan': 'The Cloudflare API calls an apply would make',
      'cloudflare:apply': 'Plan, or with `-- --yes` apply `cloudflare/zone.json` (edit token; owned rules only)',
      'publish:dist': 'Commit a build directory to the `dist` branch (CI publishes it on every push to `main`)',
      'github:check': 'Diff the live repository settings, security features, Actions permissions, and `main` ruleset against `.github/repo.json` (exit 1 on drift)',
      'github:plan': 'The GitHub API calls an apply would make',
      'github:apply': 'Plan, or with `-- --yes` apply `.github/repo.json` (admin token)',
      'check:lighthouse': 'Lighthouse against the live site with the URLs and thresholds in `tests/lighthouse.json` (needs Chrome; CI runs it weekly)',
      'clean:generated': 'Remove build output and build caches',
    },
  },
];

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
