# Technical Architecture

This document explains how `jseverino.com` is built, where data enters the system, what the build transforms, and which parts run at Cloudflare's edge.

## 1. System Shape

The site is a static Astro build deployed to Cloudflare Pages.

```text
Private vault -> sync script -> public repo snapshot -> Astro static build -> Cloudflare Pages
```

The public serving layer is static by default. The only request-time code is Cloudflare Pages Functions:

- [`functions/_middleware.ts`](../functions/_middleware.ts) rewrites HTML responses to add CSP nonces.
- [`functions/api/contact.ts`](../functions/api/contact.ts) handles contact form submissions.

There is no WordPress runtime, public admin panel, user account system, comment system, upload endpoint, or origin application server. A May 2026 migration comparison measured lower document TTFB and substantially lower page weight after this change; details are in the [WordPress to Astro migration comparison](./WordPress-To-Astro-Migration.md#may-2026-migration-comparison).

## 2. Source Of Truth

The private Obsidian vault is the editorial source of truth. This repository is the sanitized public snapshot and build source.

Synced public source files:

- [`src/content/pages/`](../src/content/pages/)
- [`src/content/writeups/`](../src/content/writeups/)
- [`src/content/site.md`](../src/content/site.md)
- [`src/content/technology-groups.md`](../src/content/technology-groups.md)
- [`public/assets/pages/`](../public/assets/pages/)
- [`public/assets/writeups/`](../public/assets/writeups/)
- [`src/lib/image-manifest.json`](../src/lib/image-manifest.json)

Cloudflare Pages builds from the committed snapshot. It does not need vault access.

## 3. Sync Pipeline

[`bin/sync-content.mjs`](../bin/sync-content.mjs) performs the private-to-public sync.

Main responsibilities:

- Read published vault pages and writeups.
- Copy `_site.md` to [`src/content/site.md`](../src/content/site.md).
- Copy `_technology-groups.md` to [`src/content/technology-groups.md`](../src/content/technology-groups.md).
- Allowlist public frontmatter fields.
- Drop vault-only metadata by omission.
- Rewrite local asset references to public `/assets/...` paths.
- Refuse asset paths that resolve outside the source folder.
- Optimize referenced images.
- Write [`src/lib/image-manifest.json`](../src/lib/image-manifest.json).
- Maintain a local content-hash manifest to detect changed writeup bodies.

The sync manifest lives under `node_modules/.cache`. It is a local acceleration and change-detection aid, not canonical content. On a first sync without a prior hash, existing `last_reviewed` or `published_at` metadata is preserved instead of stamping everything with the current date.

## 4. Content Collections

Astro content collections are defined in [`src/content.config.ts`](../src/content.config.ts).

Pages:

- `title`
- optional `description`
- optional `path`
- `published`

Writeups:

- `title`
- optional `description`
- `published`
- optional `published_at`
- optional `last_reviewed`
- optional `cover_image`
- `technologies`
- `featured`
- optional `featured_order`

Generated pages are filtered so drafts render in local dev but do not render in production builds.

## 5. Markdown Rendering

[`src/lib/content.ts`](../src/lib/content.ts) owns Markdown rendering and content loading. It uses `markdown-it` plus repo-specific transforms.

Supported transformations include:

- responsive image enhancement through `Picture.astro`;
- figure promotion and captions;
- fenced-code normalization;
- terminal blocks;
- split layouts;
- button and button-row directives;
- table wrappers with captions;
- featured project and technology cloud injection on pages.

The input is trusted owner-authored Markdown. Where custom directives interpolate text into generated HTML, the renderer escapes dynamic strings before insertion.

## 6. Site Chrome And Taxonomy

Global site chrome comes from [`src/content/site.md`](../src/content/site.md) — a YAML-frontmatter-only entry in the `site` content collection. A Zod schema in [`src/content.config.ts`](../src/content.config.ts) validates the shape at build time, so a missing field or a malformed URL fails the build with a precise error rather than rendering a broken page.

The schema covers:

- `name` — public display name (drives header brand, JSON-LD `Person.name`, page-title suffix);
- `title` — professional title (JSON-LD `Person.jobTitle`);
- `summary` — one-sentence summary (JSON-LD `Person.description`);
- `skills` — string list (`Person.knowsAbout`);
- `socialLinks` — `{label, href}[]` (footer icons, `Person.sameAs`);
- `navItems` — `{label, href}[]` (primary navigation).

[`getSiteChrome()`](../src/lib/content.ts) loads the entry via `getEntry('site', 'site')` and memoizes it for the build. The header, footer, and `SeoHead` components all await this single source of truth.

Technology labels and groupings come from [`src/content/technology-groups.md`](../src/content/technology-groups.md). Writeups store technology slugs; the renderer resolves those slugs to labels and groups at build time.

## 7. Image Pipeline

Referenced images are processed during sync, before Astro builds the site.

For each optimizable source image, the pipeline emits:

- AVIF variants at 512, 1024, and 1600 px;
- WebP variants at 512, 1024, and 1600 px;
- one optimized fallback file.

[`src/lib/image-manifest.json`](../src/lib/image-manifest.json) records the output variants and source dimensions. [`src/components/Picture.astro`](../src/components/Picture.astro) uses the manifest to render stable responsive images with explicit `width` and `height` attributes.

This design keeps image optimization deterministic and avoids runtime image services. The efficiency of this pipeline is documented in the [Custom Detection Engine comparison](./WordPress-To-Astro-Migration.md#case-study-custom-detection-engine-writeup), where the Astro version transferred far less image weight than the legacy WordPress page.

## 8. SEO And Metadata

[`src/components/SeoHead.astro`](../src/components/SeoHead.astro) emits page metadata from route-level props and shared site data.

It handles:

- document title;
- meta description;
- canonical URL;
- Open Graph metadata;
- Twitter card metadata;
- JSON-LD for `WebSite`, `Person`, `Article`, and `BreadcrumbList`;
- article published and modified dates;
- optional noindex.

The homepage canonical must be `/`, not `/home/`. The page loader preserves explicit synced paths and falls back to `/` only for the `home` slug.

## 9. Edge Security

[`public/_headers`](../public/_headers) defines the static security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`). The Content-Security-Policy is **not** set there — it is issued only by the middleware, per-request, so every HTML response carries a fresh nonce.

For every HTML response, [`functions/_middleware.ts`](../functions/_middleware.ts):

1. Generates a per-request nonce.
2. Uses `HTMLRewriter` to attach the nonce to every `<script>` tag in the response body.
3. Emits a `Content-Security-Policy` response header containing that same nonce.

Component scripts are emitted as external `/_astro/*.js` bundles (forced via `vite.build.assetsInlineLimit: 0` in [`astro.config.mjs`](../astro.config.mjs)) rather than inlined into HTML. The only inline `<script>` element in production HTML is the JSON-LD data block — which is data, not executable code, but still receives a nonce. This means CSP enforcement applies to every script the browser sees, and there is no inline executable JavaScript on the page at all.

The policy significantly reduces script-injection risk while still allowing first-party bundles, Cloudflare Web Analytics, and Cloudflare Turnstile. This move to a [nonce-based CSP](./WordPress-To-Astro-Migration.md#server-response-and-security) replaced the `'unsafe-inline'` requirements of the legacy platform, hardening the site's security posture.

The contact function applies:

- Turnstile verification;
- honeypot rejection;
- required-field validation;
- length caps;
- email format validation;
- per-IP hourly rate limiting backed by D1;
- parameterized D1 inserts.

## 10. Build Output

`npm run build:static` produces a deployable static site. Locally the build lands in `dist.nosync/`; on Cloudflare Pages (which sets `CF_PAGES=1`) it lands in `dist/`. See [`astro.config.mjs`](../astro.config.mjs) for the `outDir` selection.

The output tree:

```text
dist/
├── _astro/                     # Astro-emitted fingerprinted bundles
│   ├── *.css                   # Component + global CSS, content-hashed
│   └── *.js                    # Component <script> blocks, content-hashed
├── _headers                    # Cloudflare Pages headers (copied from public/)
├── _redirects                  # Cloudflare Pages redirects (copied from public/)
├── assets/                     # Static site assets — see §11 for the convention
│   ├── docs/                   # Downloadable documents (resume PDF, etc.)
│   ├── fonts/                  # Subset Inter variable WOFF2
│   ├── icons/                  # Favicons and apple-touch-icon
│   ├── og/                     # Open Graph card images
│   ├── pages/<slug>/           # Page-attached assets, synced from the vault
│   └── writeups/<slug>/        # Per-writeup image variants (AVIF/WebP/fallback), synced from the vault
├── functions/                  # Pages Functions (bundled separately at deploy)
├── <route>/index.html          # One HTML file per route
└── sitemap-index.xml           # @astrojs/sitemap output
```

**Fingerprinting.** Astro hashes every artifact under `_astro/` (and any image variant written by the pipeline) by content. Filenames change when bytes change, so they can be cached `immutable` for one year (see [`public/_headers`](../public/_headers)) without risk of stale serves. HTML is short-cached and revalidated.

**External scripts.** Component `<script>` blocks compile to external `/_astro/*.js` modules rather than being inlined into HTML. This is set by `vite.build.assetsInlineLimit: 0` in [`astro.config.mjs`](../astro.config.mjs). The only inline `<script>` element in any HTML response is the JSON-LD structured-data block — and that is data, not executable code. The middleware nonces every `<script>` tag the browser sees, including the external bundles.

**Functions are not in `dist/`.** Cloudflare Pages bundles the `functions/` directory separately at deploy time; it is not part of the static `dist/` tree the Astro build writes. The middleware and the contact endpoint run as Workers at the edge.

### Resource hints

[`src/layouts/BaseLayout.astro`](../src/layouts/BaseLayout.astro) emits three categories of resource hints in `<head>`, each saving real wall-clock time on first paint:

| Hint | Target | Purpose |
|---|---|---|
| `<link rel="preconnect">` | `https://static.cloudflareinsights.com` (every page) | Warms DNS + TLS for the Cloudflare Web Analytics beacon, which Cloudflare auto-injects into every HTML response. Removes ~100-300ms of cold-start latency on the first request to that origin. |
| `<link rel="preconnect">` | `https://challenges.cloudflare.com` (contact page only) | Warms DNS + TLS for Cloudflare Turnstile, which loads `turnstile/v0/api.js` from this origin on the contact page. |
| `<link rel="preload" as="font">` | `/assets/fonts/inter/inter-variable.woff2` | Starts fetching the variable font during HTML parsing, before the CSS that declares `@font-face` is parsed. Prevents the brief unstyled-text flash. `crossorigin` matches the fetch mode the browser will use for the actual font request. |

Per-page preconnect origins are passed into `BaseLayout` via the `preconnect` prop — for example, `src/pages/contact.astro` passes `preconnect={['https://challenges.cloudflare.com']}`. The site-wide insights beacon preconnect is always emitted; per-page entries are appended after it.

Resource hints are advisory: a browser may skip them under tight CPU/memory budgets, but on a healthy device they reliably shave hundreds of milliseconds off connection setup for the third-party origins this site uses.

## 11. Asset Organization

`public/` is the input side of the asset pipeline. Cloudflare Pages copies its contents verbatim into `dist/` at build time (Astro emits the rest under `_astro/` from component imports). The `public/assets/` subdirectories follow a strict convention.

| Subdirectory | Source | Purpose | Modified by |
|---|---|---|---|
| `public/assets/docs/` | Repo | Downloadable documents (e.g., `Joseph_Severino_Resume.pdf`) | Hand-edited in the repo |
| `public/assets/fonts/` | Repo | Subset web fonts (Inter variable WOFF2) | Hand-edited in the repo |
| `public/assets/icons/` | Repo | Favicons and apple-touch-icon | Hand-edited in the repo |
| `public/assets/og/` | Repo | Open Graph card images (default + per-page) | Hand-edited in the repo / `npm run make:og` |
| `public/assets/pages/<slug>/` | Vault | Page-attached assets, synced from `06 Pages/<slug>/images/` | `npm run sync:content` |
| `public/assets/writeups/<slug>/` | Vault | Writeup-attached image variants, synced from `05 Writeups/<slug>/images/` | `npm run sync:content` |

### Vault-synced vs repo-managed

This is the central distinction:

- **Vault-synced** (`pages/`, `writeups/`) tracks editorial content. Files appear here only because the vault references them. They are reprocessed (image variants, manifest entries) on every `sync:content`. **Direct edits in the repo are wiped on the next sync — edit the vault.**
- **Repo-managed** (`docs/`, `fonts/`, `icons/`, `og/`) is site chrome. These assets belong to the site as a whole, not to a single editorial page. They are tracked in the repo because they don't change often and don't need vault versioning.

A new asset that's specific to one page or writeup belongs in the vault. A new site-wide asset (a second downloadable document, a new font, a replacement favicon set) belongs in the corresponding `public/assets/<bucket>/` directory in the repo.

### Stable URLs

All assets resolve under `/assets/<bucket>/<filename>`. Filenames are not fingerprinted at this level — Astro fingerprints only what goes through `_astro/` (component bundles and component CSS). The URL of a vault-synced image will not change unless its source filename changes.

This stability is intentional for assets that external links may bookmark, like `https://jseverino.com/assets/docs/Joseph_Severino_Resume.pdf` (linked from LinkedIn, recruiter outreach, etc.).

The image *variants* emitted by the image pipeline (AVIF/WebP at multiple widths) live alongside the original under `images/` and are fingerprinted internally by content; the `<picture>` `srcset` URLs change only when source-image content hashes change.

### Cache behavior

`/assets/*` is served `immutable` with a one-year max-age (see [`public/_headers`](../public/_headers)).

- For **repo-managed assets** (favicons, fonts, OG defaults, downloadable docs): immutable caching is the right tradeoff since these change rarely. To force a refresh of an existing URL, change the filename (e.g., `resume-2027.pdf`).
- For **vault-synced images**: the image pipeline emits content-hashed variants, so a real content change produces new variant filenames that bypass the cache cleanly.

### When to add a new bucket

The convention scales by adding a new top-level bucket under `public/assets/`. Examples:
- A `videos/` bucket if you start hosting MP4/WebM downloads.
- A `data/` bucket for JSON exports or downloadable datasets.

Avoid using existing buckets for unrelated content (e.g., putting a video under `docs/`) — the bucket name is the convention contract.

## 12. Runtime Configuration

The site needs three pieces of Cloudflare-side configuration to run. None of them live in the repo; they are configured in the Cloudflare Pages project settings.

### D1 binding

| Binding | Database | Used by |
|---|---|---|
| `DB` | `jseverino-contact` | [`functions/api/contact.ts`](../functions/api/contact.ts) |

The schema lives at [`db/schema.sql`](../db/schema.sql) and is applied with:

```sh
# Remote (production):
wrangler d1 execute jseverino-contact --remote --file=./db/schema.sql

# Local (for `wrangler pages dev`):
wrangler d1 execute jseverino-contact --local --file=./db/schema.sql
```

The schema is described in detail in [`SECURITY.md`](../SECURITY.md#d1-schema).

### Function environment variables

| Variable | Scope | Used by |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Server (Pages Function env) | [`functions/api/contact.ts`](../functions/api/contact.ts) |

This is the secret half of the Cloudflare Turnstile keypair. It must never appear in the repo, the build output, or the public site. It is set in the Pages project's encrypted environment variables. For local development, copy [`.dev.vars.example`](../.dev.vars.example) to `.dev.vars` (gitignored) — `wrangler pages dev` reads it automatically.

### Build environment variables

| Variable | Scope | Used by |
|---|---|---|
| `PUBLIC_TURNSTILE_SITE_KEY` | Build (Vite `import.meta.env`) | [`src/components/ContactForm.astro`](../src/components/ContactForm.astro) |

This is the public half of the Turnstile keypair — it is safe to ship in HTML. It is set as a build environment variable in the Pages project so the static build can embed it into the contact form. For local `astro dev`, copy [`.env.example`](../.env.example) to `.env`.

### No `wrangler.toml`

This repo intentionally has no `wrangler.toml`. Pages projects with both dashboard config and a `wrangler.toml` create a precedence conflict; keeping the binding and environment configuration in the Cloudflare dashboard puts the runtime config in one place and out of the public repository.

### Local preview against the real edge runtime

`astro dev` is the day-to-day dev server. It does not run Pages Functions, so the middleware (CSP nonces) and `/api/contact` endpoint are inactive locally.

To exercise the edge runtime locally, build first and run `wrangler pages dev`:

```sh
npm run build:static
npx wrangler pages dev dist.nosync
```

The site is then served at `http://localhost:8788` with the middleware and the contact function active. `curl -sI http://localhost:8788/ | grep -i content-security-policy` is the canonical pre-deploy CSP check.

## 13. Release Gate

[`bin/publish-check.mjs`](../bin/publish-check.mjs) is the local publish gate. It runs:

1. generated output cleanup;
2. content sync;
3. iCloud conflict-copy cleanup;
4. Astro check;
5. Astro build;
6. image weight audit.

This does not replace human review, but it catches broken builds, oversized assets, and generated-file drift before publishing.

## Related Docs

- [`docs/Vault-Workflow.md`](./Vault-Workflow.md)
- [`docs/WordPress-To-Astro-Migration.md`](./WordPress-To-Astro-Migration.md)
- [`docs/Authoring-Guide.md`](./Authoring-Guide.md)
- [`docs/SEO.md`](./SEO.md)
- [`docs/Release-Checklist.md`](./Release-Checklist.md)
- [`SECURITY.md`](../SECURITY.md)
