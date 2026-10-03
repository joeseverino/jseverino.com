# Release Checklist

This checklist separates the deterministic repository gate from checks that
require a deployed environment or human judgment.

> [!NOTE]
> Every audit, spec, and baseline named here is described in [`tests/ARCHITECTURE.md`](../tests/ARCHITECTURE.md) (short tour: [`tests/README.md`](../tests/README.md)).

Use it for every pull request that deploys to production, signed releases,
and any change that affects
content sync, generated assets, Cloudflare headers, CSP, CSP reporting, SEO
metadata, D1 schema, or the contact form.

## 1. Preflight

Release work happens on a branch cut from a current `origin/main`; `main`
changes only by a merged pull request:

```sh
git fetch origin
git switch -c <branch> origin/main   # or, on an existing branch: git rebase origin/main
git status -sb
```

The worktree is clean before the gate runs.

## 2. Local Release Gate

Run the canonical repo-local gate:

```sh
npm run release:check
```

`release:check` runs `publish:check`, then the `release` audits from
[`tests/audits/registry.ts`](../tests/audits/registry.ts) (repository policy,
Playwright browser revisions, `git diff --check`, the edge runtime suite, the
cross-browser functional suite, and the macOS Chromium visual suite), then an
idempotence check that proves validation did not change repository state.

A clean `publish:check` reports one line per step:

```text
sync         content snapshot updated
content      no content changes
source       source files parse and top-level declarations are unique
dupes        <n> files, no clone of 30+ tokens over 3+ lines (40/4 between tests)
contracts    generated brand, API, schema, CSS, and edge identity projections match their canonical sources
manifest     <n> synced images have manifest entries; all <n> named files exist
drafts       <n> committed documents, none a draft
security     signed, 5 fields present, expires in <n>d, WKD file present
contrast     light <ratio>:1  <pair> (<fg> on <bg>)
parity       one content contract drives Astro/public/MCP/CLI/TUI (<fingerprint>)
types        passed
edge         contact contract drives OpenAPI/handler; <n> D1 inserts and <n> row types match storage; inserts cap per IP
preview      preview wrapped; main unchanged
unit         passed
docs-sync    generated blocks in docs/Commands.md and tests/ARCHITECTURE.md match their sources
docs         <n> docs, <n> local links, <n> script refs, <n> repo paths resolve
css-lint     passed
css-vars     passed
check        0 errors, 0 warnings
build        <n> pages built
assets       Images: <n>; Total image weight: <n>; No images over 1.5 MB.
links        <n> pages, <n> internal references (<n> unique) resolve
weight       <n> pages within budget: heaviest <page> <n>KB/150KB, CSS <n>KB/75KB, JS <n>KB/25KB
html         <n> pages: <n> ids unique per page, <n> images all carry alt, no unprocessed directives
routes       <n> pages and <n> Function routes invoke Functions; <n> static excludes carry the static CSP; <n> fallback pages
seo          <n> pages: title, canonical, og:title, og:image, valid JSON-LD
edge-runtime <n> passed (<n>s)
```

`parity` reads `skipped` where `CI` is set. `release:check` ends in
`ok release-ready`.

`release:check` snapshots the worktree before validation and fails if sync,
cleanup, generation, or testing changes repository state. A pass therefore
means the checked-out source and generated content were already internally
consistent; no second status inspection is required.

To run all codebase validations and E2E browser tests without short-circuiting on the first error, run the diagnostic suite:

```sh
npm run diagnose
```

If any check fails, it writes `.validation-report.md` in the project root with each failure's fix and rerun command. For faster iterations, run only the static checks with `npm run diagnose -- --fast`, or skip browser tests with `npm run diagnose -- --no-tests`. For machine-readable results (agents, CI), `npm run -s diagnose -- --json` emits a single JSON document with per-check status and the rerun command for each failure.

For a focused frontend check without the complete release gate, run:

```sh
npm run test:e2e:visual
```

The visual suite renders the fixture content in `tests/fixtures/content`, not
the synced writeups, so a content publish never needs a baseline update. If it
fails, inspect the expected, actual, and diff images in `test-results/visual/`.
For an intentional design change only, update and review the baselines:

```sh
npm run test:e2e:visual:update
git diff -- tests/playwright/visual.spec.ts-snapshots/
```

Commit approved baseline PNG changes with the frontend change. GitHub's
Deleted/Added image view is the version-to-version visual audit trail. Never
update snapshots merely to make the visual job pass.

If [`public/.well-known/security.txt`](../public/.well-known/security.txt)
changed (edited fields, bumped `Expires`, rotated the WKD key), re-sign before
committing:

```sh
npm run sign:security
npm run check:security
```

`sign:security` strips any existing PGP wrapper, clear-signs the body with
`security@jseverino.com`, and writes the result back in place. `check:security`
is also wired into `publish:check`, so a release with an unsigned, expired, or
WKD-mismatched `security.txt` fails the gate before the build runs.

## 3. Pull Request And Merge

Push the branch and open a pull request against `main`. The ruleset's
required checks (`build`, `e2e`, `visual`, `edge`, CodeQL, `dependency-review`,
and `Cloudflare Pages`)
must pass before a merge. Content changes go through `site publish` and
`site land` ([Site CLI](./Site-CLI.md)), and `site land` reads the same list
from the ruleset.

Review the immutable Cloudflare deployment before merging, through the
tailnet proxy ([preview access](./Cloudflare.md#preview-access)):

1. Confirm compact DEV Solo view loads.
2. Switch to LIVE and confirm the production comparison target.
3. Exercise Split, linked scrolling, mirrored navigation, Overlay, and Diff.
4. Click a status badge and review DEV/LIVE response and load deltas.
5. Open SEO and review snippet, metadata differences, and checks.
6. Verify desktop Chromium and mobile WebKit behavior.
7. Confirm browser-local notes are labeled as local and contain no sensitive
   information.

See [Deployment Preview Review](./Deployment-Preview-Review.md).

Commit source, content snapshot, generated manifest, docs, and public assets
that are part of the release. Do not commit local caches, build output,
`.env*`, `.dev.vars*`, or editor folders.

The `deploy` workflow verifies every deployment on its `*.pages.dev` URL when
the `Cloudflare Pages` check completes. After the merge, verify production from
a residential IP on a clean, current `main`:

```sh
git switch main && git pull --ff-only
npm run deploy:verify
```

It waits for the required checks on that commit, then verifies the production
dependency audit, security headers, the production sitedrift `404`, every live
sitemap URL, and zero open CodeQL alerts.

Scheduled checks measure external freshness, which no single deployment
decides, so they run on their own:

- `link check` uploads `link-check-reports`.
- `lighthouse` uploads `lighthouse-reports`.
- `scorecard` uploads `scorecard-sarif` and also sends SARIF to code scanning.

Use `npm outdated` when intentionally reviewing dependency freshness; an
available update is not itself a failed deployment.

## 4. Signed Version Tag

For a versioned release, move the signed tag only after the final release commit
is on `main`.

```sh
git tag -s -f v<version> -m "v<version> - <release summary>"
git tag -v v<version>
git push --force origin v<version>
git ls-remote origin refs/tags/v<version> refs/tags/v<version>^{}
```

`<version>` is the `version` in `package.json`. The local verification must
show a good signature. The peeled remote tag (`refs/tags/v<version>^{}`) must
point to the intended release commit.

## 5. Cloudflare Deploy Verification

After Cloudflare Pages deploys `main`, verify the live site from a clean browser
profile or with extensions disabled:

```sh
curl -I https://jseverino.com/
curl -I https://jseverino.com/portfolio/zero-trust-private-infrastructure/
```

Confirm:

- `content-security-policy` is present on HTML responses.
- The HTML CSP does not include `script-src 'unsafe-inline'`.
- `reporting-endpoints` is present on HTML responses and points to `/api/csp-report`.
- The HTML CSP includes `report-to csp-endpoint` and the `report-uri https://jseverino.com/api/csp-report` fallback.
- No `__CSP_NONCE__` placeholder survives in the HTML, and every `<script>` carries the header nonce.
- The report-only CSP carries `'strict-dynamic'` with the enforced nonce and `require-trusted-types-for 'script'`.
- `strict-transport-security` includes `includeSubDomains`.
- `x-content-type-options: nosniff` is present.
- `referrer-policy: strict-origin-when-cross-origin` is present.
- Cloudflare Web Analytics or challenge scripts do not create first-party site
  errors in a clean browser profile.

Browser-extension errors, including AdGuard content script messages, are not site
release failures unless they reproduce with extensions disabled.

**Structured check via the vault MCP.** From a Claude Code session, call the
[`check_jseverino_security_headers`](https://github.com/joeseverino/severino-vault-mcp)
tool on the local [`severino-vault-mcp`](https://github.com/joeseverino/severino-vault-mcp)
server. It returns the same headers as a structured JSON response with named
pass/fail booleans (`has_csp`, `no_unsafe_inline_script`, `has_csp_report_to`,
`has_csp_report_uri`, `has_reporting_endpoints`) in place of the `curl` parse
above.

**HAR audit (deep verification).** The MCP check confirms response headers
arrive. A HAR audit confirms that those headers do not break a real browser
session under the full third-party load. Run after any change to
[`functions/_middleware.ts`](../functions/_middleware.ts) or
[`public/_headers`](../public/_headers), and as the operational gate for
promoting Trusted Types from report-only to enforcing.

Capture HARs from a clean browser profile (DevTools, Network, "Export
HAR…" in Chromium; Develop, Show Web Inspector, Network, "Export" in
Safari) for the three high-traffic surfaces:

- `https://jseverino.com/`
- `https://jseverino.com/contact/` (loads Turnstile widget)
- `https://jseverino.com/portfolio/<a-writeup>/`

Then inspect each capture:

```sh
# All requests returned 2xx
jq -r '.log.entries[] | .response.status' ./capture.har | sort | uniq -c

# Zero CSP or Trusted Types violations were sent
jq -r '.log.entries[]
  | select(.request.url | contains("/api/csp-report"))
  | "\(.response.status) \(.request.url)"' ./capture.har
```

A clean run is: 2xx across the board (one 204 from `/cdn-cgi/rum?` is
expected) and zero output from the second command. A POST to
`/api/csp-report` means the browser tripped the enforcing CSP or the
Trusted Types report-only directive: inspect the report body in the HAR
(grep the entry's `request.postData.text` for `effective-directive`) or
read the matching D1 row to identify the source.

## 6. D1 And CSP Reporting Checks

After any change to [`cloudflare/d1.sql`](../cloudflare/d1.sql), apply the schema to the
remote D1 database (`jseverino-contact`, the `d1` value in
[`src/lib/site-config.ts`](../src/lib/site-config.ts)). Every statement is
`CREATE … IF NOT EXISTS`, so re-applying is safe:

```sh
npm run d1:apply
```

Confirm the expected operational tables exist:

```sh
npx wrangler d1 execute jseverino-contact --remote --command "SELECT name, type FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name;"
```

After deployment, confirm the CSP report table is readable:

```sh
npx wrangler d1 execute jseverino-contact --remote --command "SELECT COUNT(*) AS csp_report_count FROM csp_reports;"
```

CSP reports from browser extensions are filtered by the report endpoint and
should not be treated as site regressions.

**Trusted Types promotion gate.** The site emits
`require-trusted-types-for 'script'` in a
`Content-Security-Policy-Report-Only` header. Filter just that directive's
violations to decide whether to promote it into the enforcing CSP:

```sh
npx wrangler d1 execute jseverino-contact --remote --command \
  "SELECT created_at, disposition, document_uri, source_file, line_number
   FROM csp_reports
   WHERE effective_directive = 'require-trusted-types-for'
   ORDER BY created_at DESC LIMIT 20;"
```

Promotion criteria: ~7 days of clean reports across `/`, `/contact/`, and
at least one writeup (verified by the HAR audit in
[§5](#5-cloudflare-deploy-verification)). When the query returns no rows
across that window, move the directive from `cspReportOnly()` into the
enforcing `csp()` function in
[`functions/_middleware.ts`](../functions/_middleware.ts).

## 7. SEO And Accessibility Spot Checks

After deployment, validate the high-value URLs:

- Homepage.
- Portfolio index.
- Top flagship writeup.
- Contact page.

Check:

- PageSpeed Insights remains clean for the homepage on mobile and desktop when
  the change could affect rendering, headers, assets, or SEO. The May 27, 2026
  baseline was 100 Performance, 100 Accessibility, 100 Best Practices, and
  100 SEO in both modes.
- Google Search Console URL inspection uses the intended canonical URL.
- Rich Results Test detects Article or WebSite structured data where expected.
- The page title, meta description, canonical URL, and Open Graph image are correct.
- The sitedrift SEO panel on the final preview reports only understood,
  intentional DEV/LIVE differences.
- `site seo <url|path|slug>` renders the expected Google-style title, URL,
  description, and metadata checks from built HTML. Use
  `site seo --result <url|path|slug>` when only the snippet mockup is needed.
- Keyboard navigation reaches header links, mobile menu controls, project cards,
  footer social links, and the contact form.
- VoiceOver rotor headings show one page `h1`, then article or section headings
  in a coherent order.

## 8. Scorecard Update

Update the scorecard in the private vault only for work that was completed and
verified. Do not raise the score for planned items.

Recommended evidence to record:

- final commit SHA;
- `release:check` output summary;
- signed tag verification result;
- Cloudflare deploy URL or timestamp;
- live header check summary;
- D1 schema/reporting check summary when applicable;
- Search Console and Rich Results outcomes;
- manual keyboard and VoiceOver notes.
