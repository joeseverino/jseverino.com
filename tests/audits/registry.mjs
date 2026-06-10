// Single source of truth for the verification audits.
//
// Every gate derives its checks from this one list, so completeness is
// structural — a check added here is automatically picked up by all gates that
// claim it, and a check can never exist in one gate but silently be missing
// from another:
//
//   • publish:check  runs gates.includes('publish')  (fast local build gate)
//   • diagnose       runs gates.includes('diagnose') (the complete, run-all gate)
//   • release:check  runs publish:check (subprocess) + gates.includes('release')
//
// Each gate keeps its OWN orchestration (ordering around sync/build, fail-fast
// vs collect-all, the report). This module is data only — the inventory, not the
// run logic.
//
// Fields:
//   id          stable key (diagnose report + troubleshooting anchor)
//   label       short column label for publish-check's terse output
//   name        human title for the diagnose report
//   phase       'pre-build' (source/synced-content checks) | 'post-build' (need dist/)
//   exec        { cmd, args, env? } spawned from the repo root
//   gates       subset of ['publish','diagnose','release']
//   fix         one-line remediation (diagnose troubleshooting + report)
//   summary     publish-check terse line: 'ok' (default, first `ok …` line),
//               'astro' (errors/warnings), 'assets' (image report), or 'silent'
//   macosOnly   skip when not on darwin (committed visual baselines are macOS)
//   localOnly   skip when CI is set — the check verifies sources that live
//               outside the repo (the vault, the MCP server) and only exist
//               on the authoring machine
//   timeout     ms before the gate kills a hung check (default in bin/lib/run.mjs)

export const AUDITS = [
  {
    id: 'security-check', label: 'security', name: 'Security Signatures', phase: 'pre-build',
    exec: { cmd: 'node', args: ['tests/audits/check-security-txt.mjs'] },
    gates: ['publish', 'diagnose'],
    fix: 'Run `npm run sign:security` to sign or re-sign `public/.well-known/security.txt` with the security@ key.',
  },
  {
    id: 'contrast-check', label: 'contrast', name: 'WCAG Color Contrast', phase: 'pre-build',
    exec: { cmd: 'node', args: ['tests/audits/check-contrast.mjs'] },
    gates: ['publish', 'diagnose'],
    fix: 'Adjust colors in `src/styles/base.css` to achieve >= 4.5:1 ratio, or register the custom pair in `tests/audits/check-contrast.mjs`.',
  },
  {
    id: 'parity-check', label: 'parity', name: 'Vault/MCP/Code Parity', phase: 'pre-build',
    exec: { cmd: 'node', args: ['tests/audits/check-vault-mcp-parity.mjs'] },
    gates: ['publish', 'diagnose'], localOnly: true,
    fix: 'Ensure the vault frontmatter schema (`Frontmatter Schema.md`), Zod schema (`src/content.config.ts`), and the Python MCP server parameters agree on all fields.',
  },
  {
    id: 'functions-types', label: 'types', name: 'Functions Type Check', phase: 'pre-build',
    exec: { cmd: 'npx', args: ['tsc', '-p', 'functions/tsconfig.json'] },
    gates: ['publish', 'diagnose'], summary: 'silent',
    fix: 'TypeScript errors in `functions/*.ts` (the only TS excluded from `astro check`). Run `npm run check:types`; Cloudflare-runtime globals are declared in `functions/cloudflare.d.ts`.',
  },
  {
    id: 'functions-parity', label: 'edge', name: 'Functions/Schema Parity', phase: 'pre-build',
    exec: { cmd: 'node', args: ['tests/audits/check-functions-parity.mjs'] },
    gates: ['publish', 'diagnose'],
    fix: 'The contact handler, `db/contact-openapi.json` (API Shield), and `db/schema.sql` (D1) disagree on fields, limits, or INSERT columns. Change all three together.',
  },
  {
    id: 'preview-check', label: 'preview', name: 'Sitedrift Preview Guard', phase: 'pre-build',
    exec: { cmd: 'node', args: ['tests/audits/check-sitedrift-preview.mjs'] },
    gates: ['publish', 'diagnose'],
    fix: 'Check `tests/audits/check-sitedrift-preview.mjs`. SiteDrift proxy wrapping must be active on feature branches and absent on main.',
  },
  {
    id: 'unit-tests', label: 'unit', name: 'Unit Test Suite', phase: 'pre-build',
    exec: { cmd: 'node', args: ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', '--test', 'tests/unit/**/*.test.ts'] },
    gates: ['publish', 'diagnose'], summary: 'silent',
    fix: 'A unit spec failed: the markdown DSL, a Cloudflare Pages function, the gate harness, or the registry shape. Run `npm run test:unit` and reconcile the code or the expected behavior in `tests/unit/`.',
  },
  {
    id: 'docs-check', label: 'docs', name: 'Docs Link Integrity', phase: 'pre-build',
    exec: { cmd: 'node', args: ['tests/audits/check-docs.mjs'] },
    gates: ['publish', 'diagnose'],
    fix: 'A doc links to a renamed/removed file or an npm script that no longer exists. Fix the reference at the reported file:line, or restore the target.',
  },
  {
    id: 'css-lint', label: 'css-lint', name: 'Stylelint CSS Check', phase: 'pre-build',
    exec: { cmd: 'npx', args: ['stylelint', 'src/styles/**/*.css'] },
    gates: ['publish', 'diagnose'], summary: 'silent',
    fix: 'Fix syntax and rule violations in your CSS files located under `src/styles/`.',
  },
  {
    id: 'css-check', label: 'css-vars', name: 'CSS Unused Variables', phase: 'pre-build',
    exec: { cmd: 'node', args: ['tests/audits/check-css.mjs'] },
    gates: ['publish', 'diagnose'], summary: 'silent',
    fix: 'Remove declared CSS custom properties in `src/styles/` that are never referenced with `var(...)`.',
  },
  {
    id: 'astro-check', label: 'check', name: 'Astro Compiler Diagnostics', phase: 'pre-build',
    exec: {
      cmd: 'npx', args: ['astro', 'check', '--minimumSeverity', 'warning'],
      env: { ASTRO_TELEMETRY_DISABLED: '1', NODE_OPTIONS: '--max-old-space-size=4096' },
    },
    gates: ['publish', 'diagnose'], summary: 'astro',
    fix: 'Run `npx astro check` to debug TypeScript typing issues, content schemas, or file imports.',
  },
  {
    id: 'repo-policy', label: 'repo-policy', name: 'Repository Policy', phase: 'pre-build',
    exec: { cmd: 'node', args: ['tests/audits/check-repository-policy.mjs'] },
    gates: ['diagnose', 'release'],
    fix: 'Align Node version (.nvmrc), lockfile dependencies, commit hashes for GitHub Actions, or run `npm run clean:conflicts` to remove iCloud conflict copies.',
  },
  {
    id: 'git-diff-check', label: 'git-diff', name: 'Git Formatting/Conflicts', phase: 'pre-build',
    exec: { cmd: 'git', args: ['diff', '--check'] },
    gates: ['diagnose', 'release'], summary: 'silent',
    fix: 'Fix trailing whitespace, missing end-of-lines, or unresolved git conflict markers reported by `git diff --check`.',
  },
  {
    id: 'asset-audit', label: 'assets', name: 'Asset Weight Limits', phase: 'post-build',
    exec: { cmd: 'node', args: ['tests/audits/audit-assets.mjs'], env: { STRICT_ASSET_AUDIT: '1' } },
    gates: ['publish', 'diagnose'], summary: 'assets',
    fix: 'Optimize images in `public/assets/` to ensure none exceed 1.5MB. Set `STRICT_ASSET_AUDIT=0` if override is necessary.',
  },
  {
    id: 'links-check', label: 'links', name: 'Internal Link Integrity', phase: 'post-build',
    exec: { cmd: 'node', args: ['tests/audits/check-links.mjs'] },
    gates: ['publish', 'diagnose'],
    fix: 'A built page references an internal URL or asset the build did not emit. Fix the link at the reported page, or restore the missing target.',
  },
  {
    id: 'weight-check', label: 'weight', name: 'Page Weight Budget', phase: 'post-build',
    exec: { cmd: 'node', args: ['tests/audits/check-page-weight.mjs'] },
    gates: ['publish', 'diagnose'],
    fix: 'A page or bundle exceeded its byte budget (per-page HTML, total CSS, total JS). Slim the regression, or consciously raise the budget in `tests/audits/check-page-weight.mjs`.',
  },
  {
    id: 'html-check', label: 'html', name: 'Structural HTML', phase: 'post-build',
    exec: { cmd: 'node', args: ['tests/audits/check-html.mjs'] },
    gates: ['publish', 'diagnose'],
    fix: 'A built page repeats an id attribute or ships an <img> without alt. Fix the component or content at the reported page; decorative images use alt="", never a missing attribute.',
  },
  {
    id: 'seo-check', label: 'seo', name: 'SEO Metadata', phase: 'post-build',
    exec: { cmd: 'node', args: ['tests/audits/check-seo.mjs'] },
    gates: ['publish', 'diagnose'],
    fix: 'A built page is missing a `<title>`, canonical link, og:title/og:image, or has invalid JSON-LD. Check `src/components/SeoHead.astro` and the page frontmatter.',
  },
  {
    id: 'browser-tests', label: 'e2e', name: 'Playwright Browser Tests', phase: 'post-build',
    exec: {
      cmd: 'npx', args: ['playwright', 'test', '--reporter=line'],
      env: { CI: '1', ASTRO_TELEMETRY_DISABLED: '1', VISUAL: '1' },
    },
    gates: ['diagnose', 'release'], macosOnly: true, timeout: 15 * 60_000,
    fix: 'Run `npx playwright test --ui` to debug functional specs. If a layout change was intentional, update baselines with `npm run test:e2e:visual:update`.',
  },
];

export const auditsFor = (gate, phase) =>
  AUDITS.filter((a) => a.gates.includes(gate) && (!phase || a.phase === phase));
