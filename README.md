# jseverino.com

Personal cybersecurity portfolio for Joe Severino, built with Astro, sourced from a private Obsidian vault, and deployed as static output on Cloudflare Pages.

The repository is the public, sanitized build source. The private vault is the editorial source of truth. Cloudflare builds only from committed files in this repo; it does not need access to the vault.

```text
Private Obsidian vault -> sanitized repo snapshot -> Astro build -> Cloudflare Pages
```

## What This Repo Does

- Builds a static personal site with Astro 6.
- Syncs public pages, portfolio writeups, global site identity, navigation, and technology taxonomy from a private vault.
- Rewrites local image references into public asset paths.
- Generates AVIF, WebP, and optimized fallback image variants.
- Records image dimensions in [`src/lib/image-manifest.json`](./src/lib/image-manifest.json) so rendered images include stable `width` and `height` attributes.
- Emits canonical metadata, Open Graph/Twitter metadata, JSON-LD, sitemap, RSS, and robots.txt.
- Uses Cloudflare Pages Functions only where dynamic behavior is required: CSP nonce injection and contact form submission handling.

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
| [`public/assets/`](./public/assets/) | Synced and optimized public media. |
| [`public/_headers`](./public/_headers) | Static Cloudflare header fallback. HTML CSP is replaced by middleware in production. |
| [`public/_redirects`](./public/_redirects) | Static Cloudflare redirects. |
| [`functions/_middleware.ts`](./functions/_middleware.ts) | Per-request HTML CSP nonce generation and script nonce injection. |
| [`functions/api/contact.ts`](./functions/api/contact.ts) | Contact form endpoint with Turnstile, validation, rate limiting, and D1 storage. |
| [`bin/sync-content.mjs`](./bin/sync-content.mjs) | Vault-to-repo sync, metadata allowlisting, asset copy, image optimization, and manifest generation. |
| [`bin/publish-check.mjs`](./bin/publish-check.mjs) | Local release gate: clean, sync, check, build, CSP hash check, and asset audit. |

## Content Model

The private vault is organized as:

```text
06 Pages/
  _site.md
  _technology-groups.md
  home/index.md
  about/index.md
  contact/index.md
  resume/index.md

05 Writeups/
  project-slug/
    index.md
    images/
```

[`bin/sync-content.mjs`](./bin/sync-content.mjs) copies only published content and only allowed frontmatter fields. Vault-only fields such as internal IDs, systems, related projects, sensitivity, and operator notes are dropped by omission. Local assets are resolved against their source directory and refused if they escape that directory.

Page frontmatter may include an explicit `path`. If omitted, the site falls back to `/` for `home` and `/<slug>/` for other pages. Writeup URLs come from their folder slug.

## Image Pipeline

During sync, image references are collected from Markdown and frontmatter. Optimizable images are processed into:

- AVIF at 512, 1024, and 1600 px widths.
- WebP at 512, 1024, and 1600 px widths.
- An optimized fallback file.

The generated paths and intrinsic dimensions are written to [`src/lib/image-manifest.json`](./src/lib/image-manifest.json). [`Picture.astro`](./src/components/Picture.astro) uses that manifest to output responsive `<picture>` markup with stable dimensions, which prevents layout shift without hand-maintained image metadata.

Image encodes are cached under `node_modules/.cache/jseverino-img` by source-content hash. The cache speeds local syncs but is not part of the public source of truth.

## Metadata And SEO

`SeoHead.astro` emits:

- Canonical URL.
- Open Graph and Twitter card metadata.
- JSON-LD for `WebSite`, `Person`, `Article`, and `BreadcrumbList` where applicable.
- `robots` noindex where requested.

The `Person` schema reads from [`src/content/site.md`](./src/content/site.md), so the displayed identity, social links, and structured data stay aligned. Portfolio writeups pass published and reviewed dates into Article schema.

## Security Model

The public site is static HTML, CSS, JavaScript, and assets. There is no WordPress runtime, no public database-backed page renderer, no admin panel, no comments, no uploads, and no account system.

Dynamic behavior is intentionally narrow:

- [`functions/_middleware.ts`](./functions/_middleware.ts) runs for HTML responses, generates a nonce, adds it to every `<script>`, and replaces the static CSP with a nonce-bearing policy.
- [`functions/api/contact.ts`](./functions/api/contact.ts) accepts contact submissions, verifies Turnstile server-side, validates input, applies a per-IP hourly limit, and stores accepted messages in Cloudflare D1 with parameterized SQL.

The static [`public/_headers`](./public/_headers) CSP remains useful for local/static inspection and non-middleware contexts. [`bin/csp-hashes.mjs --check`](./bin/csp-hashes.mjs) verifies that deterministic inline script hashes in `_headers` match the built output.

## Local Commands

```sh
npm run sync:content       # Sync published vault content into the repo
npm run dev                # Start Astro dev server
npm run dev:drafts         # Sync drafts locally, then start dev server
npm run check              # Astro type/content diagnostics
npm run build:static       # Build static output to dist.nosync locally
npm run seo:preview -- /   # Preview Google-style metadata from built HTML
npm run publish:check      # Clean, sync, check, build, verify CSP, audit assets
```

The personal `site` CLI wraps these commands for day-to-day publishing, but the npm scripts are the canonical repo-local interface. `site seo [--result] <url|path|slug>` calls the same SEO preview script after a local build; `--result` prints only the Google-style snippet mockup.

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
- [`docs/Vault-Workflow.md`](./docs/Vault-Workflow.md) explains the private-to-public sync contract.
- [`docs/Authoring-Guide.md`](./docs/Authoring-Guide.md) documents supported Markdown extensions.
- [`docs/SEO.md`](./docs/SEO.md) documents canonical URLs, structured data, discovery files, and metadata flow.
- [`docs/WordPress-To-Astro-Migration.md`](./docs/WordPress-To-Astro-Migration.md) documents the platform migration decision and performance comparison.
- [`docs/Release-Checklist.md`](./docs/Release-Checklist.md) documents preflight, publish, signed tag, deploy, header, SEO, and accessibility checks.
- [`SECURITY.md`](./SECURITY.md) documents the security posture and vulnerability reporting process.

## History

This site moved from WordPress to Astro in early 2026. The main reason was architectural simplification: remove the public origin runtime, remove plugin/admin attack surface, and make the shipped site a reviewable static artifact. The migration rationale and measured comparison are documented in [`docs/WordPress-To-Astro-Migration.md`](./docs/WordPress-To-Astro-Migration.md).
