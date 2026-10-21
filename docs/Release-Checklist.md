# Release Checklist

This checklist separates the deterministic repository gate from checks that
require a deployed environment or human judgment.

> [!NOTE]
> Every audit, spec, and baseline named here is described in [`tests/ARCHITECTURE.md`](../tests/ARCHITECTURE.md) (short tour: [`tests/README.md`](../tests/README.md)).

Use it for every pull request that deploys to production, signed releases,
and any change that affects content sync, generated assets, Cloudflare headers, CSP, CSP reporting, SEO
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

Run every gate the pipeline runs (macOS, for the visual baselines):

```sh
mise run ci
```

`mise run ci` runs `mise run check` (every static gate, the production
build, every gate on the build) and then `mise run browser` (the
cross-browser, visual, and edge runtime suites, one at a time). Each phase
keeps going past a failure and ends on the list of gates that failed; each
failing gate prints its own fix. `mise run fast` runs only the static gates.
The [task list](./Commands.md#every-task) says what each gate asserts.

For a focused frontend check without the full run:

```sh
mise run browser:visual
```

The visual suite renders the fixture content in `tests/fixtures/content`, not
the synced writeups, so a content publish never needs a baseline update. If it
fails, inspect the expected, actual, and diff images in `test-results/visual/`.
For an intentional design change only, update and review the baselines:

```sh
mise run browser:visual --update-snapshots
git diff -- tests/playwright/visual.spec.ts-snapshots/
```

Commit approved baseline PNG changes with the frontend change. GitHub's
Deleted/Added image view is the version-to-version visual audit trail. Never
update snapshots merely to make the visual job pass.

If [`public/.well-known/security.txt`](../public/.well-known/security.txt)
changed (edited fields, bumped `Expires`, rotated the WKD key), re-sign before
committing:

```sh
mise run sign:security
mise run checks:security-txt
```

`sign:security` strips any existing PGP wrapper, clear-signs the body with
`security@jseverino.com`, and writes the result back in place.
`checks:security-txt` is one of the static gates, so a release with an unsigned,
expired, or WKD-mismatched `security.txt` fails before the build runs.

## 3. Pull Request And Merge

Push the branch and open a pull request against `main`. The ruleset's
required checks (`build`, `e2e`, `visual`, `edge`, `dependency-review`,
and `Cloudflare Pages`)
must pass before a merge, and its code scanning rule holds the merge while
CodeQL reports a high-severity alert or an error. Content changes go through `site publish` and
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
a clean, current `main`:

```sh
git switch main && git pull --ff-only
mise run deploy:verify
```

It waits for the required checks on that commit, then verifies security
headers, the production sitedrift `404`, every live
sitemap URL, and zero open CodeQL alerts.

Scheduled checks measure external freshness, which no single deployment
decides, so they run on their own:

- `link check` uploads `link-check-reports`.
- `lighthouse` uploads `lighthouse-reports`.
- `scorecard` sends its SARIF to code scanning.

Use `npm outdated` when intentionally reviewing dependency freshness; an
available update is not itself a failed deployment.

## 4. Signed Version Tag

Tag a versioned release once the final release commit is on `main`. A tag is
never moved: its push publishes the release.

```sh
git tag -s v<version> -m "v<version> - <release summary>"
git tag -v v<version>
git push origin v<version>
```

`<version>` is the `version` in `package.json`. The local verification must show
a good signature. The push runs
[`release.yml`](../.github/workflows/release.yml): it builds the tagged commit,
packages the build output and a CycloneDX SBOM, attests both through Sigstore
(build provenance and an SBOM attestation), and attaches all four files to the
GitHub release. To check a release:

```sh
gh release download v<version> -R joeseverino/jseverino.com -p '*.tar.gz'
gh attestation verify jseverino.com-v<version>.tar.gz -R joeseverino/jseverino.com
```

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
- No `__CSP_INLINE__` marker survives in the HTML, and the hash of every inline script and style appears in the header (`deploy:verify`'s `inline` check).
- The enforced CSP carries `script-src 'self' 'sha256-…'` plus the Turnstile and Web Analytics hosts, and `require-trusted-types-for 'script'`, with no `Content-Security-Policy-Report-Only` header. `/contact/` is the exception: no enforced Trusted Types, and a report-only header carrying it.
- `strict-transport-security` includes `includeSubDomains`.
- `x-content-type-options: nosniff` is present.
- `referrer-policy: strict-origin-when-cross-origin` is present.
- Cloudflare Web Analytics or challenge scripts do not create first-party site
  errors in a clean browser profile.

Browser-extension errors, including AdGuard content script messages, are not site
release failures unless they reproduce with extensions disabled.

**Structured check.** `site headers / --json` returns the same headers as a
structured result with named pass/fail checks (`hasCsp`, `noUnsafeInlineScript`,
`hasCspReportTo`, `hasCspReportUri`, `hasReportingEndpoints`) in place of the
`curl` parse above, and exits non-zero when any check fails.

**HAR audit (deep verification).** The header checks confirm responses carry
the headers. A HAR audit confirms those headers do not break a real browser
session under the full third-party load. Run after any change to
[`bin/build-csp.ts`](../bin/build-csp.ts) or
[`public/_headers`](../public/_headers), and as the operational gate for
touching the Trusted Types exemption for `/contact/`.

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
`/api/csp-report` means the browser tripped the enforcing CSP or, on
`/contact/`, the Trusted Types report-only directive: inspect the report body in the HAR
(grep the entry's `request.postData.text` for `effective-directive`) or
read the matching D1 row to identify the source.

## 6. D1 And CSP Reporting Checks

After any change to [`cloudflare/d1.sql`](../cloudflare/d1.sql), apply the schema to the
remote D1 database (`jseverino-contact`, the `d1` value in
[`src/lib/site-config.ts`](../src/lib/site-config.ts)). Every statement is
`CREATE … IF NOT EXISTS`, so re-applying is safe:

```sh
mise run site d1-apply --confirm
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

**Trusted Types on `/contact/`.** Every other page enforces
`require-trusted-types-for 'script'`; `/contact/` emits it in a
`Content-Security-Policy-Report-Only` header because Turnstile's script trips it.
Filter that directive's violations to see whether Turnstile still does, and
whether anything first-party has joined it:

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
across that window, remove the `/contact/*` override in
[`public/_headers`](../public/_headers) so the global policy, which enforces
the directive, applies to the page.

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
- `mise run ci` closing lines;
- signed tag verification result;
- Cloudflare deploy URL or timestamp;
- live header check summary;
- D1 schema/reporting check summary when applicable;
- Search Console and Rich Results outcomes;
- manual keyboard and VoiceOver notes.
