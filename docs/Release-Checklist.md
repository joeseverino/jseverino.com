# Release checklist

The steps around a release that need a person or a deployed environment; every
other check is a gate CI runs ([Development](./Development.md#gates)).

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

## 2. Local release gate

On macOS, `mise run ci` runs every gate the pipeline runs, the visual baselines
included ([Commands](./Commands.md#build-and-check)). A layout change follows
[the baseline rule](../AGENTS.md#visual-baselines).

If [`public/.well-known/security.txt`](../public/.well-known/security.txt)
changed (edited fields, bumped `Expires`, rotated the WKD key), re-sign before
committing:

```sh
mise run sign:security
mise run checks:security-txt
```

`sign:security` strips any existing PGP wrapper, clear-signs the body with
`security@jseverino.com`, and writes the result back in place.

## 3. Pull request and merge

Push the branch and open a pull request against `main`. The ruleset's required
checks must pass before a merge, and its code scanning rule holds the merge
while CodeQL reports a high-severity alert or an error. Content changes go
through `site publish` and `site land` ([Site CLI](./Site-CLI.md)), and
`site land` reads the same list from the ruleset.

Once `ci` passes, the `preview` workflow uploads the pull request's build as a
preview version, verifies it, and reports on the `deploy` check, whose summary
names the version URL. Review that version before merging, with the review
service token ([preview access](./Cloudflare.md#preview-access)), by the
[review procedure](./Deployment-Preview-Review.md#review-procedure).

After the merge, `ci` runs on `main`, and the `deploy` workflow uploads its
build as a version, verifies it at the version's preview URL, and only then
sends all traffic to it. Verify production from a clean, current `main`:

```sh
git switch main && git pull --ff-only
mise run deploy:verify
```

It waits for the required checks on that commit, `deploy` included, then
verifies the live site ([post-deploy verification](../tests/ARCHITECTURE.md#post-deploy-verification)).

The scheduled checks report on their own runs: `link check` to the job
summary, `lighthouse` as the `lighthouse-reports` artifact, and `scorecard` to
code scanning.

## 4. Signed version tag

Tag a versioned release once the final release commit is on `main`. A tag is
never moved: its push publishes the release.

```sh
git tag -s v<version> -m "v<version> - <release summary>"
git tag -v v<version>
git push origin v<version>
```

`<version>` is the `version` in `package.json`. The local verification must show
a good signature. The push runs
[`release.yml`](../.github/workflows/release.yml), which rebuilds nothing: it
fetches the `release-<sha>` artifact the `deploy` workflow kept when it shipped
that commit (the archive production served, its CycloneDX SBOM, and their
Sigstore provenance and SBOM attestations) and publishes the GitHub release with
all four files attached in one `gh release create`. Releases are immutable
([GitHub Settings](./GitHub-Settings.md)): once published, the files and the tag
are locked and GitHub attests the release, so a fix ships as the next version. Tag a commit `main` deployed in the last 90 days,
while that artifact exists. To check a release:

```sh
gh release verify v<version> -R joeseverino/jseverino.com
gh release download v<version> -R joeseverino/jseverino.com -p '*.tar.gz'
gh attestation verify jseverino.com-v<version>.tar.gz -R joeseverino/jseverino.com
```

## 5. Cloudflare deploy verification

`mise run deploy:verify` asserts the live headers with the same predicates as
the [edge suite](../tests/ARCHITECTURE.md#the-edge-runtime-suite-testsedge).
What it cannot see is a real browser session: after the `deploy` workflow ships
`main`, open the site in a clean browser profile or with extensions disabled and
confirm that Cloudflare Web Analytics and the Turnstile challenge create no
first-party errors.

Browser-extension errors, including AdGuard content script messages, are not site
release failures unless they reproduce with extensions disabled.

**HAR audit.** The header checks confirm responses carry the headers; a HAR
audit confirms those headers do not break a real browser session under the
full third-party load. Run it after any change to
[`bin/build-csp.ts`](../bin/build-csp.ts) or
[`public/_headers`](../public/_headers), and before touching the Trusted Types
exemption for `/contact/`. Capture a HAR from a clean browser profile for
`/`, `/contact/` (which loads Turnstile), and one writeup, then inspect each:

```sh
# Every status: all 2xx, with one 204 from /cdn-cgi/rum?
jq -r '.log.entries[] | .response.status' ./capture.har | sort | uniq -c

# CSP or Trusted Types reports sent: none
jq -r '.log.entries[]
  | select(.request.url | contains("/api/csp-report"))
  | "\(.response.status) \(.request.url)"' ./capture.har
```

A POST to `/api/csp-report` means the browser tripped the enforcing CSP or, on
`/contact/`, the Trusted Types report-only directive: the entry's
`request.postData.text` names the `effective-directive`, as does the matching
D1 row.

## 6. D1 and CSP reporting checks

After any change to [`cloudflare/d1.sql`](../cloudflare/d1.sql), apply the schema to the
production D1 database, the one [`wrangler.jsonc`](../wrangler.jsonc) binds as `DB`.
Every statement is `CREATE … IF NOT EXISTS`, so re-applying is safe:

```sh
mise run d1:schema remote
```

Then confirm the reports still arrive: `mise run site csp --count`.

CSP reports from browser extensions are filtered by the report endpoint and
should not be treated as site regressions.

**Trusted Types on `/contact/`.** Every other page enforces
`require-trusted-types-for 'script'`; `/contact/` emits it in a
`Content-Security-Policy-Report-Only` header because Turnstile's script trips it.
Filter that directive's violations to see whether Turnstile still does, and
whether anything first-party has joined it:

```sh
mise run site csp --directive require-trusted-types-for --limit 20
```

Promotion criteria: ~7 days of clean reports across `/`, `/contact/`, and
at least one writeup (verified by the HAR audit in
[§5](#5-cloudflare-deploy-verification)). When it returns no rows
across that window, remove the `/contact/*` override in
[`public/_headers`](../public/_headers) so the global policy, which enforces
the directive, applies to the page.

## 7. SEO and accessibility spot checks

After deployment, validate the high-value URLs:

- Homepage.
- Portfolio index.
- Top flagship writeup.
- Contact page.

Check:

- PageSpeed Insights holds the homepage's scores on mobile and desktop
  ([External verification](./Security.md#external-verification)) when the change
  could affect rendering, headers, assets, or SEO.
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
