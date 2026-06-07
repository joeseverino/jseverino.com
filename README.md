# jseverino.com

[![build](https://github.com/joeseverino/jseverino.com/actions/workflows/build.yml/badge.svg)](https://github.com/joeseverino/jseverino.com/actions/workflows/build.yml)
[![codeql](https://github.com/joeseverino/jseverino.com/actions/workflows/codeql.yml/badge.svg)](https://github.com/joeseverino/jseverino.com/actions/workflows/codeql.yml)
[![dependency review](https://github.com/joeseverino/jseverino.com/actions/workflows/dependency-review.yml/badge.svg)](https://github.com/joeseverino/jseverino.com/actions/workflows/dependency-review.yml)
[![scorecard](https://github.com/joeseverino/jseverino.com/actions/workflows/scorecard.yml/badge.svg)](https://github.com/joeseverino/jseverino.com/actions/workflows/scorecard.yml)
[![lighthouse](https://github.com/joeseverino/jseverino.com/actions/workflows/lighthouse.yml/badge.svg)](https://github.com/joeseverino/jseverino.com/actions/workflows/lighthouse.yml)

Personal cybersecurity portfolio for Joe Severino, built with Astro, sourced from a private Obsidian vault, and deployed as static output on Cloudflare Pages.

The repository is the public, sanitized build source. The private vault is the editorial source of truth. Cloudflare builds only from committed files in this repo; it does not need access to the vault.

```text
Private Obsidian vault -> sanitized repo snapshot -> Astro build -> Cloudflare Pages
```

## What This Repo Does

- Builds a static personal site with Astro 6.4.
- Syncs public pages, portfolio writeups, global site identity, navigation, and technology taxonomy from a private vault.
- Rewrites local image references into public asset paths.
- Generates AVIF, WebP, and optimized fallback image variants.
- Records image dimensions in [`src/lib/image-manifest.json`](./src/lib/image-manifest.json) so rendered images include stable `width` and `height` attributes.
- Emits canonical metadata, Open Graph/Twitter metadata, JSON-LD, sitemap, RSS, and robots.txt.
- Uses Cloudflare Pages Functions only where dynamic behavior is required: CSP
  nonce injection, CSP violation reporting, contact form submission handling,
  and the scoped read-only preview review proxy.
- Wraps non-production Cloudflare Pages deployments with
  [`sitedrift`](https://github.com/joeseverino/sitedrift), providing a compact
  DEV-versus-LIVE review toolbar with synchronized navigation, visual
  comparison, response deltas, and per-page SEO checks. Production output is
  not wrapped.

## Repository Map

| Path | Purpose |
| --- | --- |
| [`src/pages/`](./src/pages/) | Astro routes for pages, portfolio, tags, RSS, robots.txt, and errors. |
| [`src/layouts/BaseLayout.astro`](./src/layouts/BaseLayout.astro) | Shared document shell, preload, header, footer, and SEO head. |
| [`src/components/`](./src/components/) | Reusable UI and metadata components. |
| [`src/lib/content.ts`](./src/lib/content.ts) | Markdown rendering, custom directive transforms, content loading, taxonomy lookup, and site chrome parsing. |
| [`src/content/pages/`](./src/content/pages/) | Sanitized synced page Markdown. |
| [`src/content/writeups/`](./src/content/writeups/) | Sanitized synced portfolio Markdown. |
| [`src/content/site.md`](./src/content/site.md) | Synced public site identity, professional summary, social links, and navigation. |
| [`src/content/technology-groups.md`](./src/content/technology-groups.md) | Synced public taxonomy for technology labels and groups. |
| [`public/assets/`](./public/assets/) | Static site assets organized by bucket: `docs/` (downloadable documents), `fonts/`, `icons/`, `og/` (Open Graph cards), `pages/<slug>/` and `writeups/<slug>/` (vault-synced page and writeup assets). See [Architecture §11 Asset Organization](./docs/Architecture.md#11-asset-organization) for the convention. |
| [`public/_headers`](./public/_headers) | Static Cloudflare security headers. CSP is issued per-request by the middleware (not set here). |
| [`public/_redirects`](./public/_redirects) | Static Cloudflare redirects. |
| [`functions/_middleware.ts`](./functions/_middleware.ts) | Per-request HTML CSP nonce generation and script nonce injection. |
| [`functions/api/contact.ts`](./functions/api/contact.ts) | Contact form endpoint with Turnstile, validation, rate limiting, and D1 storage. |
| [`functions/api/csp-report.ts`](./functions/api/csp-report.ts) | CSP violation report receiver with noise filtering and D1 storage. |
| [`functions/__sitedrift/[[path]].ts`](./functions/__sitedrift/[[path]].ts) | Read-only preview-review proxy scoped to `/__sitedrift/*`. |
| [`db/schema.sql`](./db/schema.sql) | D1 schema for contact submissions and CSP reports. |
| [`bin/sync-content.mjs`](./bin/sync-content.mjs) | Vault-to-repo sync, metadata allowlisting, asset copy, image optimization, and manifest generation. |
| [`bin/publish-check.mjs`](./bin/publish-check.mjs) | Local release gate: clean, sync, check, build, and asset audit. |

## Content Model

The private vault is organized as:

```text
06 Pages/
  _site.md
  _technology-groups.md
  home/index.md
  about/index.md
  contact/index.md
  portfolio/index.md
  privacy/index.md
  resume/index.md

05 Writeups/
  project-slug/
    index.md
    images/
```

[`bin/sync-content.mjs`](./bin/sync-content.mjs) copies only published content and only allowed frontmatter fields. Vault-only fields such as internal IDs, systems, related projects, sensitivity, and operator notes are dropped by omission. Local assets are resolved against their source directory and refused if they escape that directory.

Page frontmatter may include an explicit `path`. If omitted, the site falls back to `/` for `home` and `/<slug>/` for other pages. Writeup URLs come from their folder slug. An optional `intro` field renders as the on-page subtitle below the H1; pages without one fall back to `description`, so SEO meta and visible subtitle stay coupled by default.

## Image Pipeline

During sync, image references are collected from Markdown and frontmatter. Optimizable images are processed into:

- AVIF at 512, 1024, and 1600 px widths.
- WebP at 512, 1024, and 1600 px widths.
- An optimized fallback file.

The generated paths and intrinsic dimensions are written to [`src/lib/image-manifest.json`](./src/lib/image-manifest.json). [`Picture.astro`](./src/components/Picture.astro) uses that manifest to output responsive `<picture>` markup with stable dimensions, which prevents layout shift without hand-maintained image metadata.

Image encodes are cached under `node_modules/.cache/jseverino-img` by source-content hash. The cache speeds local syncs but is not part of the public source of truth.

## Brand

The favicons, HD marks, and social cards are generated, not hand-drawn. [`src/lib/brand.mjs`](./src/lib/brand.mjs) holds the site's identity (navy `#1E3A8A` plus the `JS` glyph); the rendering logic lives in a standalone, public package, [`branding-engine`](https://github.com/joeseverino/branding-engine) ([npm](https://www.npmjs.com/package/branding-engine)). The site is just a consumer: `bin/make-icons.mjs`, `bin/make-og-image.mjs`, and `bin/make-github-social.mjs` pass `BRAND` to the engine and write to the repo's own paths.

`branding-engine` is an `optionalDependency` pinned to a published, provenance-attested npm version. Because the generated assets in `public/assets/` are committed, the production build never runs the engine — if install can't fetch it, the optional install is skipped and the static build is unchanged. The engine runs only locally, on demand, to regenerate. The full story (one navy identity, then a shared engine) is in [`docs/Brand-System.md`](./docs/Brand-System.md).

## Metadata And SEO

`SeoHead.astro` emits:

- Canonical URL.
- Open Graph and Twitter card metadata.
- JSON-LD for `WebSite`, `Person`, `Article`, and `BreadcrumbList` where applicable.
- `robots` noindex where requested.

The `Person` schema reads from [`src/content/site.md`](./src/content/site.md), so the displayed identity, social links, and structured data stay aligned. Portfolio writeups pass published and reviewed dates into Article schema.

Every non-production Pages deployment also includes sitedrift's SEO inspection
panel. It renders DEV and LIVE snippets together, compares title, description,
and canonical metadata, and checks headings, viewport, language, Open Graph,
indexing directives, favicon, and image alt coverage.

## Deployment Preview Review

Cloudflare branch and version previews open in compact sitedrift Solo mode,
showing the preview deployment as DEV and `https://jseverino.com` as LIVE.
Reviewers can switch to Split or Overlay/Diff, mirror links and scrolling,
inspect response timing deltas, open the SEO comparison, and keep notes in that
browser's `localStorage`.

[![Red DEV and navy LIVE compared in sitedrift Split view](./docs/images/sitedrift-brand-demo/red-vs-live-split.png)](https://6ef83545.jseverino.pages.dev/)

This comparison connects two tools I built. `branding-engine` turned one
temporary source-of-truth change from navy to red into a coordinated favicon,
wordmark, theme, Open Graph card, and social preview. `sitedrift` then wrapped
the immutable branch deployment and compared it directly with the unchanged
production site. The result proves both sides of the workflow: generate a
consistent brand from one decision, then review the complete deployed effect
before merging it.

![DEV and LIVE SEO checks in sitedrift](./docs/images/sitedrift-brand-demo/seo-comparison.png)

The review goes beyond appearance. It compares metadata and SEO checks,
response timing and transfer deltas, pixel differences, and browser-local
notes while keeping production untouched.

The integration is deliberately preview-only:

- `sitedrift cloudflare` activates only when `CF_PAGES=1` and
  `CF_PAGES_BRANCH` is not `main`.
- Production remains ordinary Astro output.
- `/__sitedrift/*` accepts only `GET` and `HEAD`.
- The LIVE proxy is fixed to `https://jseverino.com`.
- Contact and CSP-report routes are not modified.
- Preview responses remain `noindex`.

See [Deployment Preview Review](./docs/Deployment-Preview-Review.md) for the
workflow, architecture, security boundary, verification steps, and the
[frozen red-brand comparison](https://6ef83545.jseverino.pages.dev/).

## Security Model

The public site is static HTML, CSS, JavaScript, and assets. There is no WordPress runtime, no public database-backed page renderer, no admin panel, no comments, no uploads, and no account system.

Dynamic behavior is intentionally narrow:

- [`functions/_middleware.ts`](./functions/_middleware.ts) runs for HTML responses, generates a nonce, adds it to every `<script>`, emits a nonce-bearing CSP, and advertises the CSP report endpoint. [`public/_headers`](./public/_headers) carries the other security headers; CSP is issued only per-request by the middleware.
- [`functions/api/contact.ts`](./functions/api/contact.ts) accepts contact submissions, verifies Turnstile server-side, validates input, applies a per-IP hourly limit, and stores accepted messages in Cloudflare D1 with parameterized SQL.
- [`functions/api/csp-report.ts`](./functions/api/csp-report.ts) receives browser CSP violation reports, drops extension/off-site noise, and stores compact records in the same D1 database for review.

## Local Commands

```sh
npm run sync:content       # Sync published vault content into the repo
npm run dev                # Start Astro dev server
npm run dev:drafts         # Sync drafts locally, then start dev server
npm run check              # CSS lint/audit plus Astro type/content diagnostics
npm run lint:css           # Stylelint validation for authored CSS
npm run audit:css          # Fail on defined-but-unused CSS custom properties
npm run build:static       # Build static output to dist.nosync locally
npm run check:preview      # Prove preview wrapping and the main production guard
npm run seo:preview -- /   # Preview Google-style metadata from built HTML
npm run sign:security      # Clear-sign public/.well-known/security.txt with the security@ key
npm run check:security     # Verify the signature, required fields, Expires, and WKD file
npm run check:contrast     # Compute WCAG ratios for every text/background pair in base.css
npm run check:parity       # Assert vault Frontmatter Schema, Zod, and MCP agree on writeup fields
npm run scaffold:primer    # Scaffold a new 04 Reference/ primer with slim frontmatter
npm run scaffold:writeup-field   # Patch every layer needed for a new writeup field (dry-run by default)
npm run draft:cover-alt    # Use Claude API to draft cover_alt for one or every writeup
npm run publish:check      # security + contrast + parity + sync + check + build + audit assets
npm audit --omit=dev       # Check known dependency advisories
npm outdated               # Check direct dependency freshness
```

The personal `site` CLI wraps these commands for day-to-day publishing, but the npm scripts are the canonical repo-local interface. `site seo [--result] <url|path|slug>` calls the same SEO preview script after a local build; `--result` prints only the Google-style snippet mockup.

## Quality Automation

The repo has a small GitHub Actions suite for build, security, and credibility checks:

| Workflow | Purpose | Output |
| --- | --- | --- |
| [`build`](./.github/workflows/build.yml) | Installs from `package-lock.json`, builds the Astro site, and generates an npm SBOM. | `sbom` artifact. |
| [`codeql`](./.github/workflows/codeql.yml) | Scans JavaScript and TypeScript on pushes, PRs, and a weekly schedule. | GitHub code scanning alerts. |
| [`dependency review`](./.github/workflows/dependency-review.yml) | Blocks PRs that introduce high-severity dependency advisories. | PR check and summary comment. |
| [`workflow lint`](./.github/workflows/workflow-lint.yml) | Runs actionlint when workflow files change. | PR/push check. |
| [`link check`](./.github/workflows/link-check.yml) | Checks repository docs and public Markdown links separately. | `link-check-reports` artifact. |
| [`lighthouse`](./.github/workflows/lighthouse.yml) | Runs Lighthouse CI against selected live URLs. | `lighthouse-reports` artifact. |
| [`scorecard`](./.github/workflows/scorecard.yml) | Runs OpenSSF Scorecard. | Code scanning SARIF plus `scorecard-sarif` artifact. |

Workflow dependencies are pinned to immutable SHAs or container digests. Every workflow declares a top-level `permissions: contents: read` and scopes any `security-events: write` to the specific job that uploads SARIF. Dependabot still checks npm weekly and GitHub Actions monthly via [`.github/dependabot.yml`](./.github/dependabot.yml).

The GitHub code-scanning dashboard is kept at zero open alerts. CodeQL findings are fixed at the source; OpenSSF Scorecard findings that do not apply to a solo personal repo (Branch-Protection, Code-Review, Fuzzing, CII-Best-Practices, Maintained until the repo turns 90 days old) are dismissed with a "won't fix — solo personal repo" reason and an inline explanation. The current local Scorecard aggregate is **6.4 / 10** (2026-05-29) — failing checks are structural to a one-person project and are not real security gaps.

Preview deployments (`*.pages.dev`) carry an `X-Robots-Tag: noindex` from [`public/_headers`](./public/_headers) so only the canonical custom domain ever lands in search results.

## Current PageSpeed Snapshot

Google PageSpeed Insights reported a clean 100 across every scored category for the live homepage on May 27, 2026 at 9:14 PM CDT.

| Mode | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS | Speed Index |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Mobile, emulated Moto G Power / Slow 4G | 100 | 100 | 100 | 100 | 0.9 s | 1.8 s | 0 ms | 0 | 1.4 s |
| Desktop, emulated desktop / custom throttling | 100 | 100 | 100 | 100 | 0.3 s | 0.5 s | 0 ms | 0 | 0.4 s |

The PDFs used as evidence were exported from PageSpeed Insights for `https://jseverino.com/` with Lighthouse 13.3.0. The run also passed the trust-and-safety checks for effective CSP, strong HSTS, and Trusted Types mitigation.

## Cloudflare Operations

The Pages project owns runtime bindings in the Cloudflare dashboard; this repo intentionally has no `wrangler.toml`. The shared D1 binding is named `DB` and points at `jseverino-contact`.

Apply the D1 schema after any change to [`db/schema.sql`](./db/schema.sql):

```sh
wrangler d1 execute jseverino-contact --remote --file=./db/schema.sql
```

Check CSP reports after deployment:

```sh
wrangler d1 execute jseverino-contact --remote --command "SELECT created_at, effective_directive, blocked_uri, document_uri FROM csp_reports ORDER BY created_at DESC LIMIT 20;"
```

## Generated And Local Files

Do not commit:

- `node_modules/`, `node_modules.*`
- `.astro/`, `.vite/`
- `dist/`, `dist.nosync/`
- `.env*`, `.dev.vars*`
- `.claude/`, `.gemini/`
- `.DS_Store`
- iCloud conflict copies such as `home 2.md`

[`bin/clean-generated.mjs`](./bin/clean-generated.mjs) removes generated output and resolves iCloud conflict copies before publish checks.

## Documentation

- [`docs/Architecture.md`](./docs/Architecture.md) explains the build, content, rendering, image, and edge architecture.
- [`docs/Brand-System.md`](./docs/Brand-System.md) tells how the site's brand became one navy identity rendered by the standalone [`branding-engine`](https://github.com/joeseverino/branding-engine).
- [`docs/Vault-Workflow.md`](./docs/Vault-Workflow.md) explains the private-to-public sync contract.
- [`docs/Authoring-Guide.md`](./docs/Authoring-Guide.md) documents supported Markdown extensions.
- [`docs/SEO.md`](./docs/SEO.md) documents canonical URLs, structured data, discovery files, and metadata flow.
- [`docs/Deployment-Preview-Review.md`](./docs/Deployment-Preview-Review.md) documents the sitedrift-powered Cloudflare preview review workflow and production guard.
- [`docs/Accessibility.md`](./docs/Accessibility.md) documents landmarks, skip navigation, alt text, focus behavior, reduced motion, keyboard coverage, and contrast posture.
- [`docs/WordPress-To-Astro-Migration.md`](./docs/WordPress-To-Astro-Migration.md) documents the platform migration decision and performance comparison.
- [`docs/Release-Checklist.md`](./docs/Release-Checklist.md) documents preflight, publish, signed tag, deploy, header, SEO, and accessibility checks.
- [`SECURITY.md`](./SECURITY.md) documents the security posture and vulnerability reporting process.
- [`LICENSE`](./LICENSE) covers the original source code, written content, and images in this repository. The repo is published for transparency and review; no rights are granted to copy, modify, or redistribute without prior written permission.

## History

This site moved from WordPress to Astro in early 2026. The main reason was architectural simplification: remove the public origin runtime, remove plugin/admin attack surface, and make the shipped site a reviewable static artifact. The migration rationale and measured comparison are documented in [`docs/WordPress-To-Astro-Migration.md`](./docs/WordPress-To-Astro-Migration.md).
