# Test architecture

The map of what verifies the site: the layers, every spec and audit with the
gate that runs it, and the rules they share. [`tests/README.md`](./README.md) is
the tour, and [Development](../docs/Development.md#gates) owns the gate model
and the CI jobs. Each gate's one-line assertion is its task's `description`,
which `mise tasks --hidden` lists.

## The layers

| Layer | Runs against | Gates |
| :--- | :--- | :--- |
| [`tests/audits/`](./audits/) | the source tree, or the build in `dist/client/` | `checks:*` before the build, `built:*` on it |
| [`tests/unit/`](./unit/) | the code itself, with no build or browser | `checks:unit` |
| [`tests/playwright/`](./playwright/) | the build served by `astro preview`, in a browser | `browser:e2e`, and `browser:visual` for the fixture build |
| [`tests/edge/`](./edge/) | the build served through the local Workers runtime, by request | `browser:edge` |
| [`bin/deploy-verify.ts`](../bin/deploy-verify.ts) | a live deployment | `deploy:verify` |

Beside these, Biome and the plugins in `tests/*.grit` hold source rules in
`checks:lint`, and the gates that run a tool (types, duplication, knip, Vale,
lychee, zizmor) say what they assert in their descriptions.

## Every spec and audit

`checks:docs` holds this table to the files: a spec or audit missing from it,
or a row for a file that is gone, fails the gate.

| File | What it proves | Gate |
| :--- | :--- | :--- |
| `tests/audits/check-css.ts` | Every CSS custom property defined under `src/styles/` is read somewhere under `src/`, in a stylesheet, a template or a script. | `checks:css-vars` |
| `tests/audits/check-d1-writes.ts` | Every module under `src/` that writes D1 is imported by a unit spec that runs it against `cloudflare/d1.sql` in `node:sqlite`. | `checks:d1` |
| `tests/audits/check-docs.ts` | Every task reference, backticked repo path and file name in the engineering docs resolves, no doc runs an npm script, and each list a doc copies (the security headers, the raw HTML tags, this table) matches its source. | `checks:docs` |
| `tests/audits/check-headers.ts` | The built `_headers` has no placeholder left, lists each path once, and carries the policy on `/*` and its own on `/contact/*`. | `built:headers` |
| `tests/audits/check-html.ts` | No literal `::name` directive reaches a built page's text; html-validate holds the structural rules in the same gate. | `built:html` |
| `tests/audits/check-page-weight.ts` | Each page, the inlined CSS, total JS and each image stay within their [byte budgets](#check-page-weightts). | `built:weight` |
| `tests/audits/check-repository-policy.ts` | The Node and npm pins agree, the lock holds one copy of each native package, the Worker's compatibility date keeps up with workerd, nothing secret or built is tracked, shebangs and executable bits agree, styles live in `src/styles/`, the code is TypeScript with no unexplained suppression, and every workflow job that enables node enables npm. | `checks:repo-policy` |
| `tests/audits/check-security-txt.ts` | `security.txt` is clear-signed with a valid signature, carries the RFC 9116 fields, expires at least 60 days out, and names a committed WKD key. | `checks:security-txt` |
| `tests/audits/check-seo.ts` | Every built page has a canonical link, `og:title`, an `og:image` the build emitted, and only valid JSON-LD. | `built:seo` |
| `tests/edge/runtime.spec.ts` | `/`, `/contact/` and one built writeup carry the CSP, a hash for each inline script and style, and the security headers; a missing page or asset is a static 404 under the policy; assets carry their cache rules; a slashless path redirects; the review proxy is absent; the contact API refuses bad input before any external call; `security.txt` and the WKD key are served as committed. | `browser:edge` |
| `tests/playwright/a11y.single.spec.ts` | axe finds no WCAG A/AA violation on home, the portfolio, a writeup, contact, the resume and an open lightbox, in light and dark. | `browser:e2e` |
| `tests/playwright/contact-fallback.single.spec.ts` | Without JavaScript, or with the form's module blocked, the LinkedIn line stands in for the form, and it stays hidden while the module loads. | `browser:e2e` |
| `tests/playwright/contact.spec.ts` | The browser holds an empty form; a submit without a Turnstile token asks for the challenge; a verified submit posts exactly the fields and the token, confirms and clears; a pending submit blocks a second, and a network failure keeps the message. | `browser:e2e` |
| `tests/playwright/css-quality.spec.ts` | Each page ranks its layers in the declared order; a fragment target clears the sticky header; the skip link shows on focus; brand paint resolves in both schemes; a hovered or pressed card or button holds still; reduced motion stops transitions; cover images fill their boxes; forced colors keep outlines. | `browser:e2e` |
| `tests/playwright/lightbox.spec.ts` | A figure opens a dialog with scroll locked and focus on it; the close button and the backdrop close it without focusing the trigger; a keyboard close returns focus. | `browser:e2e` |
| `tests/playwright/menu.mobile.spec.ts` | The menu opens from its toggle, locks scroll, and closes on Escape, the backdrop and a link; without JavaScript it opens natively; links draw no tap highlight. | `browser:e2e` |
| `tests/playwright/portfolio-software.single.spec.ts` | The portfolio tabs follow clicks, keys, the `#software` hash and history, and both panels show without JavaScript; a package card shows its badge, install line and copy button; copy feedback restarts on a second click; writeup cross-links answer 200. | `browser:e2e` |
| `tests/playwright/responsive-layout.single.spec.ts` | Every sitemap page and the software tab, at phone, tablet and desktop widths, never scrolls sideways, and every table fits its box or scrolls inside it without breaking a token. | `browser:e2e` |
| `tests/playwright/routes.single.spec.ts` | `robots.txt` and `feed.xml` serve their formats, an unknown route is a real 404 page, and every sitemap page answers 200. | `browser:e2e` |
| `tests/playwright/security.single.spec.ts` | Every `target="_blank"` link on the key pages carries `rel="noopener"`. | `browser:e2e` |
| `tests/playwright/smoke.spec.ts` | The home page names its author; every primary nav link opens a page that answers 200; a writeup renders; key routes log no warning or error; the header shadows after a scroll. | `browser:e2e` |
| `tests/playwright/theme.spec.ts` | The color-scheme meta precedes every stylesheet; auto follows the OS; a choice overrides it, survives a reload and a navigation, and repaints the browser chrome and the header scrim; without JavaScript auto still works. | `browser:e2e` |
| `tests/playwright/visual.spec.ts` | Page and component screenshots of the fixture build, light and dark, match the [committed baselines](./playwright/visual.spec.ts-snapshots/). | `browser:visual` |
| `tests/unit/access.test.ts` | The Access service token goes only to this Worker's preview hosts, and a redirect to the Access login reads as a challenge. | `checks:unit` |
| `tests/unit/args.test.ts` | A script refuses an unknown flag or a stray positional with exit 2 before doing any work. | `checks:unit` |
| `tests/unit/async-cache.test.ts` | Concurrent callers share one load, and a failed load can be retried. | `checks:unit` |
| `tests/unit/brand-contract.test.ts` | The vendored brand mirror names the contract the lockfile pins, and each card render gets its own copy of the colors. | `checks:unit` |
| `tests/unit/browser-visual.test.ts` | Off macOS the visual task says it skipped and fails; on macOS it runs the visual config. | `checks:unit` |
| `tests/unit/build-csp.test.ts` | The CSP build hashes each inline tag once, fills every placeholder, fails on an unmarked script, and gives a second run the same result. | `checks:unit` |
| `tests/unit/cache.test.ts` | The cache root comes from `SITE_CACHE_DIR`, and an unset one names mise as the fix. | `checks:unit` |
| `tests/unit/canonical-json.test.ts` | Equal JSON compares equal whatever its key order and whitespace. | `checks:unit` |
| `tests/unit/check-docs.test.ts` | The docs audit's rules: which tokens name a path or a file, how each resolves, and how a copied list drifts. | `checks:unit` |
| `tests/unit/check-html.test.ts` | A directive left in page text is a leak, and code, markup and `::` inside words are not. | `checks:unit` |
| `tests/unit/check-repository-policy.test.ts` | A type-check escape needs a reason, and a shebang and the executable bit come together. | `checks:unit` |
| `tests/unit/client-script-plugins.test.ts` | The HTML-sink and after-swap plugins refuse their patterns in TypeScript and in an `.astro` file. | `checks:unit` |
| `tests/unit/cloudflare.test.ts` | `cloudflare/zone.json` matches its schema and type, and `mise run cloudflare` reports drift, plans, and applies only owned rules. | `checks:unit` |
| `tests/unit/contact-api.test.ts` | The contact handler's validation, honeypot, Turnstile verification, rate limit and D1 writes, against the real schema. | `checks:unit` |
| `tests/unit/content-contract.test.ts` | `contracts/content.v1.json` drives the public projection, the writeup store and `site manage`. | `checks:unit` |
| `tests/unit/content-properties.test.ts` | Over generated input, the content guard admits only allowed tags and safe URL schemes, and no event handler. | `checks:unit` |
| `tests/unit/content-render.test.ts` | Each block, fence, placeholder and image modifier renders the HTML it must, and the guard refuses MDX code. | `checks:unit` |
| `tests/unit/content-sync.test.ts` | The sync finds every asset reference, refuses one outside its folder, writes and prunes its outputs, and checks a whole vault. | `checks:unit` |
| `tests/unit/csp-report-api.test.ts` | The CSP report endpoint reads both formats, drops noise, caps each IP, and stores reports in the real schema. | `checks:unit` |
| `tests/unit/csp.test.ts` | The policy module hashes inline code and builds a policy with no nonce or escape hatch. | `checks:unit` |
| `tests/unit/deploy-workflow.test.ts` | The deploy check main requires is the one the workflow writes, and no job holds a secret beside install scripts or a repository write. | `checks:unit` |
| `tests/unit/dev-server.test.ts` | A dev server counts only when its lock names a live process whose URL answers. | `checks:unit` |
| `tests/unit/draft-cover-alt.test.ts` | Cover-alt drafting skips unpublished writeups and never applies an unusable reply. | `checks:unit` |
| `tests/unit/drift.test.ts` | Drift compares values whatever their key order, and a bad invocation exits 2 before loading anything. | `checks:unit` |
| `tests/unit/edge-expectations.test.ts` | The predicates the edge suite and `deploy:verify` share flag every policy escape hatch, missing hash, wrong header and wrong cache rule. | `checks:unit` |
| `tests/unit/education-source.test.ts` | The education export is read once and held to its published schema, and a failure says what failed. | `checks:unit` |
| `tests/unit/explicit-inputs.test.ts` | The sync reads each machine path from its variable, and only the audit log reads the home directory. | `checks:unit` |
| `tests/unit/fetch-json.test.ts` | A JSON fetch returns the body of a 200, rejects an error status, and times out a stalled server. | `checks:unit` |
| `tests/unit/frontmatter.test.ts` | Frontmatter parses, round-trips and keeps its YAML types, and a non-mapping block is refused. | `checks:unit` |
| `tests/unit/gate-summary.test.ts` | The gate summary names every failed or unreached gate and never counts one as passed. | `checks:unit` |
| `tests/unit/git.test.ts` | `gitAsync` resolves to trimmed stdout and rejects with git's own stderr. | `checks:unit` |
| `tests/unit/github.test.ts` | `.github/repo.json` agrees with itself and the site config, and `mise run github` reports drift. | `checks:unit` |
| `tests/unit/headers-file.test.ts` | `_headers` parses as Cloudflare reads it, and the Worker's own responses take the `/*` rule. | `checks:unit` |
| `tests/unit/html.test.ts` | The built-page readers return decoded values, and undefined for an absent element. | `checks:unit` |
| `tests/unit/json-schema.test.ts` | The schema validator names each problem's path and refuses an unknown keyword. | `checks:unit` |
| `tests/unit/json.test.ts` | `writeJson` creates its directory, ends in a newline, and round-trips through `readJson`. | `checks:unit` |
| `tests/unit/link-check-workflow.test.ts` | A pull request that edits any doc the docs gates read runs the link check. | `checks:unit` |
| `tests/unit/literal-values.test.ts` | The color and font-size plugins refuse literals and pass tokens. | `checks:unit` |
| `tests/unit/local-paths.test.ts` | Every machine path comes from its variable, with no default. | `checks:unit` |
| `tests/unit/manage-input.test.ts` | `site manage` reads keys whole and stages edits until an explicit save or discard. | `checks:unit` |
| `tests/unit/map-limit.test.ts` | `mapLimit` never exceeds its limit and keeps the input order. | `checks:unit` |
| `tests/unit/mise.test.ts` | A doc names a task by its name, an alias or a matching glob, and every task carries a description. | `checks:unit` |
| `tests/unit/package-registry.test.ts` | The registry snapshot reads PyPI and npm versions and fails whole on one failed lookup. | `checks:unit` |
| `tests/unit/playwright-summary.test.ts` | The Playwright summary fails a run on a flaky test or a stopped run, and never counts a skip as passed. | `checks:unit` |
| `tests/unit/pr-comment.test.ts` | The pull request comment links each required check and folds only passing summaries. | `checks:unit` |
| `tests/unit/publish-dist.test.ts` | Publishing `dist` commits only a changed build, with its trailers, and leaves the checkout alone. | `checks:unit` |
| `tests/unit/request-json.test.ts` | The request reader holds its byte limit on any stream and turns bad bodies into client errors. | `checks:unit` |
| `tests/unit/rest.test.ts` | Each REST client sends its token only as a bearer header, bounds each call, and never prints the token. | `checks:unit` |
| `tests/unit/routes.test.ts` | A route maps to the file it is served from. | `checks:unit` |
| `tests/unit/run-harness.test.ts` | The process runner resolves on a failed, missing or hung command, and never hangs. | `checks:unit` |
| `tests/unit/scorecard-workflow.test.ts` | The Scorecard workflow meets what the OpenSSF API needs to publish its result. | `checks:unit` |
| `tests/unit/security-txt.test.ts` | Verification fails a modified file against the committed key, and the gate fails 60 days before `Expires`. | `checks:unit` |
| `tests/unit/site-cli.test.ts` | The `site` CLI's `--json` documents, usage errors, and neutralized terminal controls. | `checks:unit` |
| `tests/unit/site-git.test.ts` | `repoState` reads the branch, changes and last commit of a real checkout. | `checks:unit` |
| `tests/unit/site-manage.test.ts` | `site manage` refuses to start without a terminal, and its frames and saves act on a temp vault. | `checks:unit` |
| `tests/unit/site-ops.test.ts` | Contact submissions come redacted unless `--pii`, which releases nothing without its audit line. | `checks:unit` |
| `tests/unit/site-orchestration.test.ts` | `site publish` and `site land` against a real remote and a stubbed `gh`: they commit only declared outputs, and every failure is reported. | `checks:unit` |
| `tests/unit/site-protocol.test.ts` | Every `--json` document the CLI prints is valid under the published protocol schema. | `checks:unit` |
| `tests/unit/site-render.test.ts` | `site render` renders a vault writeup or stdin as the page would, and refuses a missing slug. | `checks:unit` |
| `tests/unit/sitemap-lastmod.test.ts` | Each sitemap entry takes the date of the newest writeup it shows, or none. | `checks:unit` |
| `tests/unit/snapshot.test.ts` | The snapshot readers read the content root the build reads, from any working directory. | `checks:unit` |
| `tests/unit/source-adapters.test.ts` | An iCloud conflict copy never becomes a slug. | `checks:unit` |
| `tests/unit/step-summary.test.ts` | Text written to a step summary cannot forge a workflow command. | `checks:unit` |
| `tests/unit/tui.test.ts` | The terminal layer measures, clips and windows text, and every bound key is in the key table. | `checks:unit` |
| `tests/unit/type-escapes.test.ts` | The type-escape plugin refuses a cast to `never` or through `unknown`, in an `.astro` file too. | `checks:unit` |
| `tests/unit/vacuous-assertions.test.ts` | The vacuous-assertion plugin refuses an inequality that passes for any result. | `checks:unit` |
| `tests/unit/wrap-preview.test.ts` | A preview branch's build gets the review viewer and a filled CSP, `main`'s ships as the adapter wrote it, and a foreign deploy config is refused. | `checks:unit` |
| `tests/unit/writeup-body.test.ts` | A writeup body drops the title, lede and cover its page renders from frontmatter, and a paragraph repeating its description. | `checks:unit` |
| `tests/unit/writeup-store.test.ts` | Frontmatter writes change only their key and keep the YAML structure and the body bytes. | `checks:unit` |

## Design rules

- **The build under test.** The browser and edge suites serve the build through
  `astro preview`, which runs it in Cloudflare's `workerd` through the adapter,
  never the dev server. `PREBUILT=1` reuses one `mise run build:browser`.
- **Projects by file name.** In [`playwright.config.ts`](./playwright.config.ts),
  `*.mobile.spec.ts` runs on the mobile devices, `*.single.spec.ts` on
  `chromium-desktop` alone, and the rest on every desktop engine. In CI a
  failure runs once more with a trace, and a pass only on that retry fails the run.
- **One harness.** Every browser and edge spec imports `test` and `expect` from
  [`helpers/test.ts`](./playwright/helpers/test.ts), which a `noRestrictedImports`
  override in `biome.jsonc` enforces. On WebKit that module drops
  `upgrade-insecure-requests` from the preview's document CSP, since WebKit
  upgrades the plain-http preview and loads nothing; production keeps the
  directive. Its route turns on WebKit's interception, which fails Turnstile's
  `blob:` load, so the module names that one console error for `smoke.spec.ts`.
- **Elements as a person finds them.** A spec finds an element by role, label or
  text. A class stays only where the test measures that component's own style
  or shoots it alone. A lookup for an element that ships hidden passes
  `includeHidden`, so a hidden assertion still names a real element.
- **Readiness is a condition.** A spec waits on `settle()` (fonts and eager
  images), `expect.poll`, or the page's own events, never a sleep or
  `networkidle`.
- **Content by capability.** The functional specs resolve writeups from the
  synced snapshot by what they hold ([`helpers/writeups.ts`](./playwright/helpers/writeups.ts)),
  so renaming a writeup breaks no gate. The visual suite builds only the
  synthetic tree in [`fixtures/content/`](./fixtures/content/), with no network
  call, so a baseline moves only with a layout or a fixture. Baselines are
  macOS Chromium renders.
- **Turnstile stays out.** A spec that does not test the challenge aborts its
  script (`withoutTurnstile`), since its always-pass key solves on its own
  schedule. The contact spec writes the token field the widget writes.
- **An audit is importable.** Each audit exports its rule and runs only under
  `import.meta.main`, so a unit spec tests the rule without a repo or a build.
  It ends through `finish()` in [`lib.ts`](./audits/lib.ts), which requires a
  fix: one for a single rule's problems, or one on each problem.
- **D1 writes meet the schema.** A unit spec that runs a D1 writer builds
  `cloudflare/d1.sql` in `node:sqlite` ([`d1-sqlite.ts`](./unit/helpers/d1-sqlite.ts)),
  so SQLite rejects a column the schema lacks.

### Rules a tool holds

- Biome (`checks:lint`) refuses an explicit `any`, `@ts-ignore`, a non-null
  assertion, a hex color in a stylesheet, and `@playwright/test` imported past
  the harness.
- The plugins [`literal-colors.grit`](./literal-colors.grit) and
  [`literal-font-sizes.grit`](./literal-font-sizes.grit) refuse literal colors
  and font sizes in `src/styles/`, outside the token blocks `mise run sync:tokens`
  fences with `biome-ignore-start`.
- [`client-html-sinks.grit`](./client-html-sinks.grit),
  [`view-transition-hooks.grit`](./view-transition-hooks.grit) and
  [`type-escapes.grit`](./type-escapes.grit) refuse HTML sinks, after-swap
  listeners and type escapes under `src/`, and
  [`vacuous-assertions.grit`](./vacuous-assertions.grit) an inequality that
  passes for any result under `tests/`.
- jactionlint and zizmor hold the workflows: a timeout on every job, no
  `-latest` runner, every action pinned to a SHA.

## Adding a new audit

1. Write `tests/audits/check-<thing>.ts`. Resolve paths from `siteRoot` in
   [`src/lib/site-root.ts`](../src/lib/site-root.ts), read built pages through
   `builtPages()`, and end through `finish()`.
2. Declare the task in [`mise-tasks/checks.toml`](../mise-tasks/checks.toml) as
   `checks:<thing>` or [`mise-tasks/built.toml`](../mise-tasks/built.toml) as
   `built:<thing>`, hidden, with a `description` stating what a pass
   guarantees. The aggregates run it by glob.
3. Add its row to the table above, and run `mise run fast`.

## Audit detail

### `check-page-weight.ts`

Four budgets over the emitted output: per-page HTML, CSS (the largest
stylesheet a page inlines, plus any external `.css` a page loads, which leaves
out `embed/bundle.css`), total JS, and each image. Each sits about a quarter
above what the build ships, and raising one is its own commit to the file. It is
the deterministic complement to the weekly Lighthouse run.

## Edge runtime and post-deploy verification

### The edge runtime suite (`tests/edge/`)

The API routes and the served [`public/_headers`](../public/_headers) exist only
in the Workers runtime, so the browser suite cannot see them. The edge suite
uses Playwright's request fixture alone, on the port and runtime
[`playwright.edge.config.ts`](./playwright.edge.config.ts) sets, and its
expectations are the functions in
[`src/lib/edge-expectations.ts`](../src/lib/edge-expectations.ts), which
`deploy:verify` asserts against production.

### Post-deploy verification

`mise run deploy:verify` runs from a clean `main` checkout after a merge
deploys: remote CI status, live headers and HSTS, hash coverage of inline code,
cache rules, every sitemap route, the contact gate, `security.txt` parity, the
`dist` branch and open CodeQL alerts. The `deploy` workflow runs it with
`--origin` against each Worker version's preview URL before production takes
that version; [`bin/deploy-verify.ts`](../bin/deploy-verify.ts) lists its flags.
