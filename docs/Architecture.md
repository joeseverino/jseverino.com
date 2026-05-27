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

Global site chrome comes from [`src/content/site.md`](../src/content/site.md).

That file controls:

- public display name;
- professional title;
- summary used by structured data;
- skills used in `Person.knowsAbout`;
- social links used in footer and `Person.sameAs`;
- primary navigation links.

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
├── assets/                     # Synced static assets and image variants
│   ├── fonts/                  # Subset Inter variable WOFF2
│   ├── media/                  # Site iconography and OG defaults
│   ├── og/                     # Open Graph card images
│   ├── pages/                  # Page-attached assets
│   └── writeups/<slug>/        # Per-writeup images, AVIF/WebP/fallback variants
├── functions/                  # Pages Functions (bundled separately at deploy)
├── <route>/index.html          # One HTML file per route
└── sitemap-index.xml           # @astrojs/sitemap output
```

**Fingerprinting.** Astro hashes every artifact under `_astro/` (and any image variant written by the pipeline) by content. Filenames change when bytes change, so they can be cached `immutable` for one year (see [`public/_headers`](../public/_headers)) without risk of stale serves. HTML is short-cached and revalidated.

**External scripts.** Component `<script>` blocks compile to external `/_astro/*.js` modules rather than being inlined into HTML. This is set by `vite.build.assetsInlineLimit: 0` in [`astro.config.mjs`](../astro.config.mjs). The only inline `<script>` element in any HTML response is the JSON-LD structured-data block — and that is data, not executable code. The middleware nonces every `<script>` tag the browser sees, including the external bundles.

**Functions are not in `dist/`.** Cloudflare Pages bundles the `functions/` directory separately at deploy time; it is not part of the static `dist/` tree the Astro build writes. The middleware and the contact endpoint run as Workers at the edge.

## 11. Runtime Configuration

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

## 12. Release Gate

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
