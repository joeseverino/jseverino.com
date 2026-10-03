# WordPress To Astro Migration

This document records the business and engineering case for moving
`jseverino.com` from WordPress to Astro. Besides the framework, the migration
changed how the site is operated: fewer moving parts, less public attack
surface, lower transfer weight, and a repository that is the reviewable source
of what ships.

## Executive Summary

The WordPress version proved that the content model worked: project writeups,
portfolio taxonomy, images, and SEO metadata were already valuable. The issue
was the platform overhead required to serve mostly static content.

Astro was selected because the public site does not need runtime page
rendering, database-backed routing, comments, uploads, a public admin panel, or
visitor accounts. Static output gives the same reader experience with a smaller
operational surface.

The result:

- content is written privately in a [Vault-driven workflow](./Vault-Workflow.md), then synced through an allowlisted pipeline;
- pages are generated as static HTML, CSS, JavaScript, and optimized assets;
- screenshots are encoded to responsive AVIF and WebP at build time by the [image pipeline](./Architecture.md#8-image-pipeline);
- [metadata, sitemap, RSS, JSON-LD, and canonical URLs](./SEO.md) are generated from the same content source;
- Cloudflare Pages serves the site without exposing a WordPress runtime (see [Architecture](./Architecture.md)).

## Decision Drivers

| Driver | WordPress Site | Astro Site |
| --- | --- | --- |
| Public runtime | PHP, WordPress, theme, plugins, database | Static files on Cloudflare Pages |
| Admin surface | Public WordPress admin path unless externally protected | No public admin application |
| Plugin risk | Plugin/theme code executes in the public origin | No production plugin runtime |
| Content source | Database plus theme/plugin behavior | Markdown snapshot generated from the [private vault](./Vault-Workflow.md) |
| Image delivery | Large PNG screenshots from uploads | Responsive AVIF/WebP plus optimized fallbacks |
| Reviewability | Runtime behavior spread across WordPress, plugins, database, and theme | Public repo contains the build source and [generated content snapshot](./Architecture.md#2-source-of-truth) |
| Deployment | Origin application and database must remain healthy | Static deploy artifact can be [rebuilt and redeployed](./Architecture.md#14-release-gate) |

## Architecture Change

Before:

```text
Browser -> Cloudflare -> WordPress origin -> PHP runtime -> database -> theme/plugins -> uploaded media
```

After:

```text
Private vault -> sync script -> Astro static build -> Cloudflare Pages -> browser
```

Cloudflare still sits at the edge, but its role is narrower. It serves static
assets, applies headers, runs a [small HTML middleware](../functions/_middleware.ts) for CSP nonces and reporting, and
handles the [contact form endpoint](../functions/api/contact.ts) plus the [CSP report endpoint](../functions/api/csp-report.ts). Preview Pages deployments also carry a [read-only sitedrift review layer](./Deployment-Preview-Review.md) for visual and SEO comparison against the live site. It no longer fronts a public WordPress page
renderer.

## May 2026 Migration Comparison

On May 24, 2026, a focused migration comparison was conducted between the
production Astro site and the legacy WordPress origin, to check the migration
decision against measurable signals: transferred bytes, request count, response
time, security posture, and codebase reviewability.

Measurements used:

- Safari Network panel captures for real browser transfer behavior.
- Lighthouse 13.3.0 JSON output for repeatable lab metrics.
- `curl` timing for document-level response checks.
- A locally captured legacy HAR for historical worst-case WordPress transfer.

Synthetic Lighthouse scores are treated as supporting evidence only. They are
sensitive to Cloudflare challenge scripts, analytics behavior, cache state,
viewport, and network conditions.

### Case Study: Custom Detection Engine Writeup

This case study compares the live load performance of the same article on both
platforms.

- Legacy: `https://wp.jseverino.com/portfolio/architecting-a-custom-detection-engine/`
- Current: `https://jseverino.com/portfolio/architecting-a-custom-detection-engine/`

| Measurement | Legacy WordPress | Current Astro |
| --- | ---: | ---: |
| Lighthouse requests | 19 | 13 |
| Lighthouse total byte weight | 1.16 MB | 476 KB |
| Dominant payload | PNG screenshots | AVIF screenshots |
| Largest Lighthouse image | 343 KB PNG | 42.5 KB AVIF |
| First-party failures | 0 | 0 |

This Lighthouse article run showed approximately a 58.9% total byte-weight
reduction:

```text
(1.16 MB - 476 KB) / 1.16 MB = 58.9%
```

The historical HAR benchmark below represents a larger worst-case legacy load,
where the WordPress page pulled many full-size PNG screenshots. The live
Lighthouse comparison is the more conservative number; the HAR comparison shows
why the image pipeline was still an important architecture decision.

#### Historical Worst-Case Benchmark

The old HAR contained 20 PNG image transfers totaling 18.42 MB. That represents
the uncached cost of the legacy site:

| Legacy asset | Transfer |
| --- | ---: |
| `vigilant-2048x1464.png` | 1.97 MB |
| `main_file-2-2048x1362.png` | 1.53 MB |
| `phptest-2048x1312.png` | 1.46 MB |
| `SEM_hardening-2048x1362.png` | 1.35 MB |
| `install-2-2048x1424.png` | 1.32 MB |

### Case Study: Homepage Migration Baseline

The May 24, 2026 migration baseline already showed the Astro homepage
shipping less JavaScript, less total payload, faster first paint, stronger
accessibility, and better SEO than the legacy WordPress homepage.

| Measurement | Legacy WordPress | Astro migration baseline |
| --- | ---: | ---: |
| Lighthouse requests | 25 | 16 |
| Lighthouse total byte weight | 1.15 MB | 610 KB |
| Lighthouse First Contentful Paint | 1.1 s | **0.8 s** |
| Lighthouse Accessibility | 96 | **100** |
| Lighthouse SEO | 85 | **92** |

That baseline was before the final homepage polish. The current PageSpeed
snapshot below shows the homepage after those fixes: 100 Performance, 100
Accessibility, 100 Best Practices, and 100 SEO on both mobile and desktop.
The WordPress homepage remains useful as a comparison point, but the article
comparison is more representative of the migration's asset-pipeline win because
portfolio writeups carry the largest image payloads.

### Codebase Profile

At the time of the migration (May 2026), the application and infrastructure
source was a small set of repository files. On the WordPress site, the
equivalent was spread across a database, plugins, and a theme. The repository
has since moved to TypeScript only; the table is the migration-time snapshot.

| Layer | Language / Type | Lines of Code |
| --- | --- | ---: |
| **Business Logic** | TypeScript / MJS | ~1,600 |
| **Templating** | Astro | ~700 |
| **Styles** | Vanilla CSS | ~1,300 |
| **Infrastructure** | SQL / Config | ~500 |
| **Generated Data** | JSON ([Image Manifest](./Architecture.md#8-image-pipeline)) | ~4,900 |

Most of the line count was deterministic metadata generated by the
[image pipeline](./Architecture.md#8-image-pipeline). The handwritten logic
covered content rendering, responsive assets, and edge security.

### Server Response and Security

Beyond asset weight, the migration improved raw delivery speed and security
posture by removing the PHP/database dependency.

| Metric | Legacy WordPress | Current Astro |
| --- | ---: | ---: |
| Document TTFB, homepage (`curl`) | ~0.83 s | **~0.26 s** |
| Document TTFB, article (`curl`) | ~0.96 s | **~0.34 s** |
| Script Security | `'unsafe-inline'` required | **Nonce-based CSP** |
| Origin Surface | Public PHP/MySQL | **Static Edge** |

The observed TTFB improvement comes from replacing dynamic PHP/database page
rendering with static edge delivery. Exact response timing varies with cache
state, Cloudflare routing, and client network conditions, so these numbers
are a snapshot.
The [nonce-based Content Security Policy](./Architecture.md#10-edge-security) also reduces script-injection risk; WordPress's reliance on inline scripts made that hard to maintain.

## Lighthouse Notes

Lighthouse is useful for the current Astro site, but it is sensitive to the
deployment environment. A common pitfall when measuring either the legacy
WordPress site or a protected Astro staging environment is Cloudflare Access.
If Access is active for the target origin, Lighthouse will measure the
performance and weight of the Access login challenge rather than the actual
site content.

Use Lighthouse for current-site regression checks:

```sh
lighthouse \
  https://jseverino.com/portfolio/architecting-a-custom-detection-engine/ \
  --output=json \
  --output-path=/tmp/jseverino-astro-lighthouse.json \
  --quiet \
  --chrome-flags="--headless --disable-gpu"
```

### Measurement Caveats

When performing automated measurements, verify that the origin is reachable
without a challenge. During the May 24, 2026 audit, Cloudflare Access was
temporarily disabled so the results reflected the site content instead of the
login challenge. An "Access-blocked" measurement typically shows:

- **Inaccurate LCP:** The login challenge scripts can push Largest Contentful
  Paint well beyond 5 seconds.
- **Payload mismatch:** The byte weight and request count will reflect the
  Cloudflare Access application, not the Astro build.
- **False signals:** Accessibility and SEO scores will be based on the login
  template.

The May 24, 2026 Astro article baseline reported:

| Metric | Value |
| --- | ---: |
| Accessibility | 98 |
| SEO | 100 |
| First Contentful Paint | 1.0 s |
| Largest Contentful Paint | 5.2 s |
| Cumulative Layout Shift | 0 |
| First-viewport total byte weight | 476 KiB |
| First-viewport network requests | 13 |

This article baseline is kept as a migration artifact: it records
the payload reduction at the time the WordPress-to-Astro decision was validated.
Later homepage PageSpeed results measure a different surface. Together: the
migration cut the writeup pages' payload, and later homepage work brought the
homepage to 100 in every PageSpeed category.

## Current PageSpeed Snapshot

After post-migration work, Google PageSpeed Insights reported 100 in every
category for the live homepage on May 27, 2026 at 9:14 PM CDT:

| Mode | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS | Speed Index |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Mobile, emulated Moto G Power / Slow 4G | 100 | 100 | 100 | 100 | 0.9 s | 1.8 s | 0 ms | 0 | 1.4 s |
| Desktop, emulated desktop / custom throttling | 100 | 100 | 100 | 100 | 0.3 s | 0.5 s | 0 ms | 0 | 0.4 s |

The PageSpeed run used Lighthouse 13.3.0 against `https://jseverino.com/`.
The Best Practices panel passed the trust-and-safety checks for effective CSP,
strong HSTS, and Trusted Types mitigation, with no Lighthouse-visible UX or
compatibility regressions from the security headers.
Compared with the May 24 homepage baseline, the current run raises SEO from 92
to 100 while keeping Accessibility at 100 and adding 100 Best Practices and 100
Performance scores on both throttled mobile and desktop profiles.

## Security And Operations Impact

Work the migration removed from production operations:

- no WordPress core update window for the public site;
- no public plugin/theme execution path;
- no database-backed page rendering for ordinary readers;
- no public upload endpoint;
- no public comment or account surface;
- no live admin panel required for publishing.

The remaining dynamic pieces are narrow and explicit:

- [`functions/_middleware.ts`](../functions/_middleware.ts) fills the build's
  nonce placeholders in HTML responses and advertises the CSP report endpoint.
- [`functions/api/contact.ts`](../functions/api/contact.ts) handles contact
  submissions with Turnstile verification, input validation, rate limiting, and
  D1 storage.
- [`functions/api/csp-report.ts`](../functions/api/csp-report.ts) stores filtered
  browser CSP violation reports in the same D1 database for operational review.
- [`functions/__sitedrift/[[path]].ts`](../functions/__sitedrift/[[path]].ts)
  provides a read-only comparison route only when a preview build generated its
  configuration; production requests fail closed with `404`.

## Operational Shift

The most significant change is the move from a "Live Admin" model to a
"Private-First" content model. In WordPress, content was authored and stored
within the public origin's database. In the Astro architecture, the public
site is a read-only snapshot of a private editorial system.

- **Content Isolation:** The [Vault Workflow](./Vault-Workflow.md) syncs only
  public fields of published content to the repository. Sensitive
  metadata and draft content remain entirely outside the public surface.
- **Tooling Independence:** Editorial work is performed in a local vault using
  native tools (VS Code, Obsidian) instead of a browser-based CMS.
- **Atomic Deploys:** Because the site is built from a deterministic content
  snapshot, every deploy is a verifiable artifact that can be rolled back or
  audited in the repository history.

## Pre-flight Validation

The migration replaced manual WordPress maintenance (plugin updates, theme
checks, security scanning) with automated quality gates. Before any content
update is published, the site is validated against the project's engineering
standards.

The `publish:check` script acts as the final gate:

```sh
npm run publish:check
```

On a typical run (observed May 24, 2026), this validates:
- **Integrity:** Zero TypeScript errors and zero Astro check warnings.
- **Scale:** Successful build of 70+ pages and 500+ optimized images.
- **Optimization:** [Image weight limits](./Architecture.md#14-release-gate) (no single asset over
  1.5 MB).

The operational work moved from monitoring a live runtime to verifying a static
build. The current gates are described in [`tests/ARCHITECTURE.md`](../tests/ARCHITECTURE.md).

## Business Outcome

The site is optimized for trust, speed, maintainability, and auditability over
CMS convenience. WordPress worked while the content model was evolving; Astro
fits a site that is now a portfolio and technical writing archive.

The public repository also shows the static architecture, security headers, CSP
handling, content sync, and responsive image processing behind the site.

## Measurement Artifacts

The legacy HAR used for the comparison was captured locally. It is not committed to the repo because HAR files can contain response bodies,
tokens, cookies, headers, and local browsing context. The summarized values in
this document are the public-safe output of that measurement.

Useful local extraction commands:

```sh
jq '.log.entries | length' /path/to/file.har

jq '[.log.entries[] | (.response._transferSize // .response.bodySize // 0) | select(. > 0)] |
  {known_transfer_bytes: add, known_transfer_mb: (add/1048576), counted_entries: length}' \
  /path/to/file.har

jq -r '.log.entries[] |
  select((.response._transferSize // .response.bodySize // 0) > 0) |
  [((.response._transferSize // .response.bodySize) | tostring), .response.content.mimeType, .request.url] |
  @tsv' /path/to/file.har | sort -nr | head -15
```

## Related Documentation

- [`docs/Architecture.md`](./Architecture.md): detailed security and infrastructure model.
- [`docs/Vault-Workflow.md`](./Vault-Workflow.md): the sync pipeline and editorial process.
- [`docs/Authoring-Guide.md`](./Authoring-Guide.md): guidelines for content structure and assets.
- [`docs/SEO.md`](./SEO.md): metadata and search engine optimization strategy.
- [`SECURITY.md`](../SECURITY.md): vulnerability reporting and security posture.
