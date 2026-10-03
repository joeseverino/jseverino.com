// The verification audits. Every gate derives its checks from this list, so a
// check added here runs in every gate that claims it:
//
//   • gate:check     runs gates.includes('gate')     (fast pre-build invariants, collect-all; CI's first step)
//   • publish:check  runs gates.includes('publish')  (fast local build gate)
//   • diagnose       runs gates.includes('diagnose') (the complete, run-all gate)
//   • release:check  runs publish:check (subprocess) + gates.includes('release'),
//                    so an audit publish already runs does not also claim release
//
// Each gate keeps its OWN orchestration (ordering around sync/build, fail-fast
// vs collect-all, the report). This module is data only.
//
// Fields:
//   id          stable key (diagnose report + troubleshooting anchor)
//   label       short column label for publish-check's terse output
//   name        human title for the diagnose report
//   asserts     one line: what a pass guarantees (the audit table in tests/ARCHITECTURE.md)
//   phase       'pre-build' (source/synced-content checks) | 'post-build' (need dist/)
//   exec        { cmd, args, env?, jsonArgs? } spawned from the repo root;
//               jsonArgs are appended when SITE_JSON=1 (set by `site --json`)
//   gates       subset of ['gate','publish','diagnose','release']
//   fix         one-line remediation (diagnose troubleshooting + report)
//   summary     publish-check terse line: 'ok' (default, first `ok …` line),
//               'astro' (errors/warnings), 'assets' (image report), or 'silent'
//   macosOnly   skip when not on darwin (committed visual baselines are macOS)
//   localOnly   skip when CI is set: the check verifies sources that live
//               outside the repo (the vault, the MCP server) and only exist
//               on the authoring machine
//   timeout     ms before the gate kills a hung check (default in bin/lib/run.ts)
//   heavy       a browser suite: the runners cap how many run at once by memory
//   lock        audits sharing a lock never overlap ('astro': both write .astro/)

export type Gate = 'gate' | 'publish' | 'diagnose' | 'release';
export type Phase = 'pre-build' | 'post-build';

export interface Audit {
  id: string;
  label: string;
  name: string;
  asserts: string;
  phase: Phase;
  exec: { cmd: string; args: readonly string[]; env?: Readonly<Record<string, string>>; jsonArgs?: readonly string[] };
  gates: readonly Gate[];
  fix: string;
  summary?: 'ok' | 'astro' | 'assets' | 'silent';
  macosOnly?: boolean;
  localOnly?: boolean;
  timeout?: number;
  heavy?: boolean;
  lock?: 'astro';
}

export const AUDITS: readonly Audit[] = [
  {
    id: 'source-integrity', label: 'source', name: 'Source Integrity', phase: 'pre-build',
    asserts: 'Every .ts file under bin/, src/, and tests/ parses, and no file declares the same top-level function twice.',
    exec: { cmd: 'node', args: ['tests/audits/check-source-integrity.ts'] },
    gates: ['gate', 'publish', 'diagnose'],
    fix: 'Fix the reported parse error or duplicate top-level function. The duplicate is legal JavaScript, so no compiler step reports it.',
  },
  {
    id: 'duplication', label: 'dupes', name: 'No Duplicated Code', phase: 'pre-build',
    asserts: 'No run of 30+ identical tokens over 3+ lines appears twice in the tracked TypeScript (40/4 between two test files).',
    exec: { cmd: 'node', args: ['tests/audits/check-duplication.ts'] },
    gates: ['gate', 'publish', 'diagnose'],
    fix: 'Two places carry the same run of code. Extract one shared primitive (bin/lib, src/lib, functions/lib, or a test helper) and import it from both; generated files and test content are exempt in tests/audits/check-duplication.ts.',
  },
  {
    id: 'contract-projections', label: 'contracts', name: 'Generated Contract Projections', phase: 'pre-build',
    asserts: 'Each generated projection (brand tokens, contact OpenAPI, content schemas, embed CSS, edge site identity) matches what its script derives from the canonical source.',
    exec: { cmd: 'node', args: ['tests/audits/check-contract-projections.ts'] },
    gates: ['publish', 'diagnose', 'release'],
    fix: 'Regenerate the stale projection with the `run:` command it names (sync:tokens, sync:contract, sync:contact-openapi, make:embed, or sync:edge-site); generated artifacts must exactly match their canonical inputs.',
  },
  {
    id: 'image-manifest', label: 'manifest', name: 'Image Manifest Coverage', phase: 'pre-build',
    asserts: 'Every synced png/jpg under public/assets/writeups and public/assets/pages has a manifest entry, and every variant and fallback an entry names exists.',
    exec: { cmd: 'node', args: ['tests/audits/check-image-manifest.ts'] },
    gates: ['gate', 'publish', 'diagnose'],
    fix: 'A synced image under public/assets has no entry in src/lib/image-manifest.json, or the manifest names a variant that does not exist. Run `npm run sync:content` and commit everything it wrote; a production build refuses a synced image without an entry.',
  },
  {
    id: 'no-drafts', label: 'drafts', name: 'No Drafts in the Snapshot', phase: 'pre-build',
    asserts: 'No document under src/content is `published: false`.',
    exec: { cmd: 'node', args: ['tests/audits/check-no-drafts.ts'] },
    gates: ['gate', 'publish', 'diagnose'],
    fix: 'A `published: false` document is in src/content, where it would deploy. Re-run `npm run sync:content`; preview drafts with `site dev --drafts`, which writes to the gitignored overlay.',
  },
  {
    id: 'security-check', label: 'security', name: 'Security Signatures', phase: 'pre-build',
    asserts: '`security.txt` is clear-signed with a valid signature, carries the RFC 9116 fields, expires at least 30 days out, and its Encryption URL names a committed WKD key.',
    exec: { cmd: 'node', args: ['tests/audits/check-security-txt.ts'] },
    gates: ['publish', 'diagnose'],
    fix: 'Run `npm run sign:security` to sign or re-sign `public/.well-known/security.txt` with the security@ key.',
  },
  {
    id: 'contrast-check', label: 'contrast', name: 'WCAG Color Contrast', phase: 'pre-build',
    asserts: 'Every registered text/background color pairing in the tokens meets WCAG AA (4.5:1).',
    exec: { cmd: 'node', args: ['tests/audits/check-contrast.ts'] },
    gates: ['publish', 'diagnose'],
    fix: 'The colors come from severino-brand through `npm run sync:tokens` (the token block in `src/styles/tokens.css` is generated): change the color upstream or the pairing in `src/styles/`. Register a new intended pair in `pairs` in `tests/audits/check-contrast.ts`.',
  },
  {
    id: 'parity-check', label: 'parity', name: 'Vault/MCP/Code Parity', phase: 'pre-build',
    asserts: 'The content contract, its generated Astro schema, the MCP projection, and the `site manage` TUI agree on one fingerprint.',
    exec: { cmd: 'node', args: ['tests/audits/check-vault-mcp-parity.ts'] },
    gates: ['publish', 'diagnose'], localOnly: true,
    fix: 'Edit `contracts/content.v1.json`, run `npm run sync:contract` (it also writes the projection in the vault MCP checkout), and commit every generated projection in both repos. Never hand-edit a projection.',
  },
  {
    id: 'typecheck', label: 'types', name: 'TypeScript Type Check', phase: 'pre-build',
    asserts: 'Every TypeScript file compiles under one strict program, and functions/ again under the Workers lib.',
    exec: { cmd: 'npm', args: ['run', '-s', 'typecheck'] },
    lock: 'astro', gates: ['gate', 'publish', 'diagnose'], summary: 'silent',
    fix: 'Run `npm run typecheck`. One strict program covers bin/, src/, tests/, and the configs; functions/ compiles again under the Workers lib, with Cloudflare-runtime globals declared in `functions/cloudflare.d.ts`. `astro check` covers the .astro files.',
  },
  {
    id: 'functions-parity', label: 'edge', name: 'Functions/Schema Parity', phase: 'pre-build',
    asserts: 'The contact contract projects exactly to the API Shield schema, the handler consumes the contract, and every INSERT names only columns db/schema.sql defines.',
    exec: { cmd: 'node', args: ['tests/audits/check-functions-parity.ts'] },
    gates: ['publish', 'diagnose'],
    fix: 'The contact handler, `db/contact-openapi.json` (API Shield), and `db/schema.sql` (D1) disagree on fields, limits, or INSERT columns. Change all three together.',
  },
  {
    id: 'preview-check', label: 'preview', name: 'Sitedrift Preview Guard', phase: 'pre-build',
    asserts: 'The sitedrift review wrapper is present on preview branches and absent on main.',
    exec: { cmd: 'node', args: ['tests/audits/check-sitedrift-preview.ts'] },
    gates: ['publish', 'diagnose'],
    fix: 'The sitedrift wrapper must be present on preview branches and absent on main. Check the build-static sitedrift step and `tests/audits/check-sitedrift-preview.ts`.',
  },
  {
    id: 'unit-tests', label: 'unit', name: 'Unit Test Suite', phase: 'pre-build',
    asserts: 'The `node:test` specs under tests/unit pass.',
    exec: { cmd: 'node', args: ['--test', 'tests/unit/**/*.test.ts'] },
    gates: ['publish', 'diagnose'], summary: 'silent',
    fix: 'Run `npm run test:unit` and reconcile the code or the expected behavior in the failing spec under `tests/unit/`.',
  },
  {
    id: 'docs-projection', label: 'docs-sync', name: 'Generated Documentation Blocks', phase: 'pre-build',
    asserts: 'The generated blocks in docs/Commands.md and tests/ARCHITECTURE.md match bin/help.ts and this registry.',
    exec: { cmd: 'node', args: ['bin/sync-docs.ts', '--check'] },
    gates: ['gate', 'publish', 'diagnose'],
    fix: 'A generated block in docs/Commands.md or tests/ARCHITECTURE.md lags its source (the groups in bin/help.ts, the entries in tests/audits/registry.ts). Run `npm run sync:docs` and commit the result.',
  },
  {
    id: 'docs-check', label: 'docs', name: 'Docs Reference Integrity', phase: 'pre-build',
    asserts: 'Every relative link and its #anchor, `npm run` script, and backticked repo path in the engineering docs resolves.',
    exec: { cmd: 'node', args: ['tests/audits/check-docs.ts'] },
    gates: ['gate', 'publish', 'diagnose'],
    fix: 'A doc links to a renamed/removed file or heading, names an npm script that no longer exists, or backticks a repo path git neither tracks nor ignores. Fix the reference at the reported file:line, or restore the target; an intentional example path goes in EXAMPLE_PATHS in tests/audits/check-docs.ts.',
  },
  {
    id: 'css-lint', label: 'css-lint', name: 'Stylelint CSS Check', phase: 'pre-build',
    asserts: 'Stylelint passes over src/styles.',
    exec: { cmd: 'npx', args: ['stylelint', 'src/styles/**/*.css'] },
    gates: ['gate', 'publish', 'diagnose'], summary: 'silent',
    fix: 'Fix the reported Stylelint violations under `src/styles/`.',
  },
  {
    id: 'css-check', label: 'css-vars', name: 'CSS Unused Variables', phase: 'pre-build',
    asserts: 'Every CSS custom property defined in src/styles is referenced somewhere in src/.',
    exec: { cmd: 'node', args: ['tests/audits/check-css.ts'] },
    gates: ['publish', 'diagnose'], summary: 'silent',
    fix: 'Remove the reported custom property from `src/styles/`, or add the `var(...)` use that needs it.',
  },
  {
    id: 'astro-check', label: 'check', name: 'Astro Compiler Diagnostics', phase: 'pre-build',
    asserts: '`astro check` reports no errors or warnings in the .astro files, content schemas, or imports.',
    exec: {
      cmd: 'npx', args: ['astro', 'check', '--minimumSeverity', 'warning', '--tsconfig', 'tsconfig.astro.json'],
      env: { ASTRO_TELEMETRY_DISABLED: '1', NODE_OPTIONS: '--max-old-space-size=4096' },
      jsonArgs: ['--json'],
    },
    lock: 'astro', gates: ['publish', 'diagnose'], summary: 'astro',
    fix: 'Run `npm run check` and fix the reported .astro type, content-schema, or import error.',
  },
  {
    id: 'repo-policy', label: 'repo-policy', name: 'Repository Policy', phase: 'pre-build',
    asserts: 'Node, npm, and lockfile pins agree; no secrets or build output tracked; stylesheet rules hold; TypeScript only, no explicit any or unexplained suppressions; actions SHA-pinned, runners fixed, every job time-boxed.',
    exec: { cmd: 'node', args: ['tests/audits/check-repository-policy.ts'] },
    gates: ['gate', 'diagnose', 'release'],
    fix: 'Fix the reported rule: the Node and npm pins (.nvmrc, engines, packageManager), the lockfile, a tracked forbidden file, a stylesheet rule, a JavaScript file or explicit any, or a workflow (SHA pin, fixed runner, timeout-minutes).',
  },
  {
    id: 'playwright-browsers', label: 'browsers', name: 'Playwright Browser Revisions', phase: 'pre-build',
    asserts: 'The installed Chromium, Firefox, and WebKit revisions match the locked Playwright package.',
    exec: { cmd: 'node', args: ['tests/audits/check-playwright-browsers.ts'] },
    gates: ['diagnose', 'release'], macosOnly: true,
    fix: 'Install the browser revisions required by the lockfile with `npx playwright install chromium firefox webkit`.',
  },
  {
    id: 'git-diff-check', label: 'git-diff', name: 'Git Formatting/Conflicts', phase: 'pre-build',
    asserts: '`git diff --check` finds no whitespace errors or conflict markers.',
    exec: { cmd: 'git', args: ['diff', '--check'] },
    gates: ['diagnose', 'release'], summary: 'silent',
    fix: 'Fix trailing whitespace, missing end-of-lines, or unresolved git conflict markers reported by `git diff --check`.',
  },
  {
    id: 'asset-audit', label: 'assets', name: 'Asset Weight Limits', phase: 'post-build',
    asserts: 'No image under public/assets exceeds 1.5 MB (strict mode); reports the count and total weight.',
    exec: { cmd: 'node', args: ['tests/audits/audit-assets.ts'], env: { STRICT_ASSET_AUDIT: '1' } },
    gates: ['publish', 'diagnose'], summary: 'assets',
    fix: 'Shrink the reported image under `public/assets/` below 1.5 MB. Run the audit without `STRICT_ASSET_AUDIT=1` for a warn-only report.',
  },
  {
    id: 'links-check', label: 'links', name: 'Internal Link Integrity', phase: 'post-build',
    asserts: 'Every internal href, src, poster, and srcset in the built HTML resolves to an emitted file or a Function route.',
    exec: { cmd: 'node', args: ['tests/audits/check-links.ts'] },
    gates: ['publish', 'diagnose'],
    fix: 'A built page references an internal URL or asset the build did not emit. Fix the link at the reported page, or restore the missing target.',
  },
  {
    id: 'weight-check', label: 'weight', name: 'Page Weight Budget', phase: 'post-build',
    asserts: 'Per-page HTML (150 KB), CSS (75 KB), and total JS (25 KB) stay within budget.',
    exec: { cmd: 'node', args: ['tests/audits/check-page-weight.ts'] },
    gates: ['publish', 'diagnose'],
    fix: 'A page or bundle exceeded its byte budget (per-page HTML, total CSS, total JS). Reduce it, or raise the budget in `tests/audits/check-page-weight.ts` in its own commit.',
  },
  {
    id: 'html-check', label: 'html', name: 'Structural HTML', phase: 'post-build',
    asserts: 'No built page repeats an id, every <img> has alt, and no literal `::name` directive reaches the page text.',
    exec: { cmd: 'node', args: ['tests/audits/check-html.ts'] },
    gates: ['publish', 'diagnose'],
    fix: 'A built page repeats an id attribute, ships an <img> without alt, or shows a literal `::name` directive. Fix the component or content at the reported page; decorative images use alt="", never a missing attribute; a leaked directive is a typo or one the page\'s renderer does not support.',
  },
  {
    id: 'routes-check', label: 'routes', name: 'Functions Routing', phase: 'post-build',
    asserts: 'public/_routes.json stays inside the Pages limits and excludes no built HTML page or Function route; every exclude is a prefix with its static fallback page or an exact built file, and carries the static CSP in _headers.',
    exec: { cmd: 'node', args: ['tests/audits/check-routes.ts'] },
    gates: ['publish', 'diagnose'],
    fix: 'public/_routes.json excludes a path that serves HTML or a Function route, breaks the Pages limits, or lacks its static CSP or fallback page. Narrow the exclude (an excluded HTML page ships without the middleware CSP), add the static CSP rule for it to public/_headers, and rebuild so bin/build-static.ts writes the fallback.',
  },
  {
    id: 'seo-check', label: 'seo', name: 'SEO Metadata', phase: 'post-build',
    asserts: 'Every built page has a title, canonical link, og:title, og:image, and only valid JSON-LD; zero pages fails.',
    exec: { cmd: 'node', args: ['tests/audits/check-seo.ts'] },
    gates: ['publish', 'diagnose'],
    fix: 'A built page is missing a `<title>`, canonical link, og:title/og:image, or has invalid JSON-LD. Check `src/components/SeoHead.astro` and the page frontmatter.',
  },
  {
    id: 'edge-tests', label: 'edge-runtime', name: 'Edge Runtime Tests', phase: 'post-build',
    asserts: 'Served through `wrangler pages dev`: the CSP nonce, the _headers rules, _routes.json, a real 404, the contact refusals, and security.txt parity.',
    exec: {
      cmd: 'npx', args: ['playwright', 'test', '-c', 'playwright.edge.config.ts', '--reporter=line'],
      env: { ASTRO_TELEMETRY_DISABLED: '1' },
    },
    heavy: true, gates: ['diagnose', 'release'], timeout: 10 * 60_000,
    fix: 'The build failed under the Cloudflare runtime (`wrangler pages dev`): a rule in public/_headers, the CSP middleware, or a Pages Function regressed. Run `npm run test:edge`; `npm run edge:serve` reproduces the served responses by hand.',
  },
  {
    id: 'browser-tests', label: 'e2e', name: 'Playwright Browser Tests', phase: 'post-build',
    asserts: 'The functional Playwright specs pass across the browser matrix.',
    exec: {
      cmd: 'npx', args: ['playwright', 'test', '--reporter=line'],
      env: { ASTRO_TELEMETRY_DISABLED: '1' },
    },
    heavy: true, gates: ['diagnose', 'release'], timeout: 15 * 60_000,
    fix: 'Run `npx playwright test --ui` to debug the functional specs.',
  },
  {
    id: 'visual-tests', label: 'visual', name: 'Visual Regression (fixture content)', phase: 'post-build',
    asserts: 'Screenshots of the fixture build match the committed macOS Chromium baselines.',
    exec: {
      cmd: 'npx', args: ['playwright', 'test', '-c', 'playwright.visual.config.ts', '--reporter=line'],
      env: { ASTRO_TELEMETRY_DISABLED: '1' },
    },
    heavy: true, gates: ['diagnose', 'release'], macosOnly: true, timeout: 10 * 60_000,
    fix: 'Inspect expected/actual/diff under test-results/visual/. If the layout or a fixture changed on purpose, re-baseline with `npm run test:e2e:visual:update` and review every PNG in the diff.',
  },
];

export const auditsFor = (gate: Gate, phase?: Phase): Audit[] =>
  AUDITS.filter((a) => a.gates.includes(gate) && (!phase || a.phase === phase));
