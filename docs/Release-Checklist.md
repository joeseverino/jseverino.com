# Release Checklist

This checklist is the human release gate for `jseverino.com`. It complements
[`npm run publish:check`](../bin/publish-check.mjs), which performs the local
automated checks.

Use it for production pushes, signed releases, and any change that affects
content sync, generated assets, Cloudflare headers, CSP, CSP reporting, SEO
metadata, D1 schema, or the contact form.

## 1. Preflight

Confirm the branch is clean and current:

```sh
git status -sb
git log -1 --oneline
```

The expected status before release work is:

```text
## main...origin/main
```

If local commits exist, push them before starting deploy validation. If remote
commits exist, pull or rebase first.

## 2. iCloud Conflict Copies

The repo currently lives in an iCloud-synced path. iCloud can create numbered
conflict-copy files or directories such as `home 2.md` or `building-a-homelab 2`.
Those are local filesystem artifacts, not source files.

Check for conflict copies before the release gate:

```sh
find src/content public/assets -name '* [0-9]' -o -name '* [0-9].*'
```

`publish:check` runs [`bin/clean-generated.mjs`](../bin/clean-generated.mjs),
which resolves numbered copies in generated content and asset roots. If conflict
copies are reported, treat them as release noise that must be resolved before the
final status check. Do not commit numbered copies.

## 3. Local Release Gate

Run the canonical repo-local gate:

```sh
npm run publish:check
npm audit --omit=dev
npm outdated
```

A clean release should report:

```text
security   signed, 5 fields present, expires in <n>d, WKD file present
contrast   <n> pairs measured, all >= 4.5:1
parity     schema/Zod/MCP agree on writeup fields: ...
sync       content snapshot updated
check      0 errors, 0 warnings
build      <n> pages built
assets     Images: <n>; Total image weight: <n>; No images over 1.5 MB.
npm audit  0 vulnerabilities
npm outdated  no direct packages listed
```

Then confirm the worktree is still intentional:

```sh
git status -sb
```

Content changes from the private vault are expected only when the release is
intended to publish those changes.

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

## 4. Commit And Push

Commit source, content snapshot, generated manifest, docs, and public assets
that are part of the release:

```sh
git add <changed-files>
git commit -m "<release commit message>"
git push origin main
```

Do not commit local caches, build output, `.env*`, `.dev.vars*`, editor folders,
or numbered iCloud conflict copies.

After pushing, confirm the expected GitHub Actions checks pass. The normal
remote gate is:

- `build`
- `codeql`
- `workflow lint` when workflow files changed
- `dependency review` on pull requests
- `link check`, `lighthouse`, and `scorecard` on their schedules or when run manually

For scheduled/manual quality checks, download artifacts when investigating a
failure or recording evidence:

- `build` uploads `sbom`.
- `link check` uploads `link-check-reports`.
- `lighthouse` uploads `lighthouse-reports`.
- `scorecard` uploads `scorecard-sarif` and also sends SARIF to code scanning.

After a release that touches any GitHub Actions workflow, container action,
or build script, confirm the code-scanning dashboard is still clean:

```sh
gh api repos/:owner/:repo/code-scanning/alerts \
  --paginate \
  --jq 'group_by(.state) | map({state: .[0].state, count: length})'
```

The expected state is zero `open` alerts. If CodeQL or Scorecard reports
something new, treat it as a release-blocking finding: fix at the source
for CodeQL, evaluate-then-fix-or-dismiss-with-justification for Scorecard.
Scorecard alerts can also be stale after a remediation commit — trigger
`gh workflow run scorecard.yml` and recheck before treating them as real.

## 5. Signed Version Tag

For a versioned release, move the signed tag only after the final release commit
is on `main`.

```sh
git tag -s -f v3.0.0 -m "v3.0.0 - <release summary>"
git tag -v v3.0.0
git push --force origin v3.0.0
git ls-remote origin refs/tags/v3.0.0 refs/tags/v3.0.0^{}
```

The local verification must show a good signature. The peeled remote tag
(`refs/tags/v3.0.0^{}`) must point to the intended release commit.

## 6. Cloudflare Deploy Verification

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
- The HTML CSP includes `report-to csp-endpoint` and `report-uri https://jseverino.com/api/csp-report`.
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
`has_csp_report_uri`, `has_reporting_endpoints`) — one call replaces the
`curl` parse above.

**HAR audit (deep verification).** The MCP check confirms response headers
arrive. A HAR audit confirms that those headers do not break a real browser
session under the full third-party load. Run after any change to
[`functions/_middleware.ts`](../functions/_middleware.ts) or
[`public/_headers`](../public/_headers), and as the operational gate for
promoting Trusted Types from report-only to enforcing.

Capture HARs from a clean browser profile (DevTools → Network → "Export
HAR…" in Chromium, or Develop → Show Web Inspector → Network → "Export"
in Safari) for the three high-traffic surfaces:

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
Trusted Types report-only directive — inspect the report body in the HAR
(grep the entry's `request.postData.text` for `effective-directive`) or
read the matching D1 row to identify the source.

## 7. D1 And CSP Reporting Checks

After any change to [`db/schema.sql`](../db/schema.sql), apply the schema to the
remote D1 database:

```sh
wrangler d1 execute jseverino-contact --remote --file=./db/schema.sql
```

Confirm the expected operational tables exist:

```sh
wrangler d1 execute jseverino-contact --remote --command "SELECT name, type FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name;"
```

After deployment, confirm the CSP report table is readable:

```sh
wrangler d1 execute jseverino-contact --remote --command "SELECT COUNT(*) AS csp_report_count FROM csp_reports;"
```

CSP reports from browser extensions are filtered by the report endpoint and
should not be treated as site regressions.

**Trusted Types promotion gate.** The site emits
`require-trusted-types-for 'script'` in a
`Content-Security-Policy-Report-Only` header. Filter just that directive's
violations to decide whether to promote it into the enforcing CSP:

```sh
wrangler d1 execute jseverino-contact --remote --command \
  "SELECT created_at, disposition, document_uri, source_file, line_number
   FROM csp_reports
   WHERE effective_directive = 'require-trusted-types-for'
   ORDER BY created_at DESC LIMIT 20;"
```

Promotion criteria: ~7 days of clean reports across `/`, `/contact/`, and
at least one writeup (verified by the HAR audit in
[§6](#6-cloudflare-deploy-verification)). When the query returns no rows
across that window, move the directive from `cspReportOnly()` into the
enforcing `csp()` function in
[`functions/_middleware.ts`](../functions/_middleware.ts).

## 8. SEO And Accessibility Spot Checks

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
- `site seo <url|path|slug>` renders the expected Google-style title, URL,
  description, and metadata checks from built HTML. Use
  `site seo --result <url|path|slug>` when only the snippet mockup is needed.
- Keyboard navigation reaches header links, mobile menu controls, project cards,
  footer social links, and the contact form.
- VoiceOver rotor headings show one page `h1`, then article or section headings
  in a coherent order.

## 9. Scorecard Update

Update the vault scorecard in `00 Reporting` only for work that was actually
completed and verified. Do not raise the score for planned items.

Recommended evidence to record:

- final commit SHA;
- `publish:check` output summary;
- signed tag verification result;
- Cloudflare deploy URL or timestamp;
- live header check summary;
- D1 schema/reporting check summary when applicable;
- Search Console and Rich Results outcomes;
- manual keyboard and VoiceOver notes.
