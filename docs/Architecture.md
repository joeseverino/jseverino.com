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

There is no WordPress runtime, public admin panel, user account system, comment system, upload endpoint, or origin application server.

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

This design keeps image optimization deterministic and avoids runtime image services.

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

[`public/_headers`](../public/_headers) defines the static header baseline. In production HTML responses, [`functions/_middleware.ts`](../functions/_middleware.ts) replaces the static CSP with a nonce-based policy:

1. Generate a per-request nonce.
2. Use `HTMLRewriter` to add the nonce to every `<script>` tag.
3. Emit a `Content-Security-Policy` header containing that nonce.

The policy significantly reduces script-injection risk while still allowing first-party scripts, Cloudflare Web Analytics, and Cloudflare Turnstile. CSP is one layer in a smaller static-site attack surface, not a substitute for careful rendering and narrow dynamic endpoints.

The contact function applies:

- Turnstile verification;
- honeypot rejection;
- required-field validation;
- length caps;
- email format validation;
- per-IP hourly rate limiting backed by D1;
- parameterized D1 inserts.

## 10. Release Gate

[`bin/publish-check.mjs`](../bin/publish-check.mjs) is the local publish gate. It runs:

1. generated output cleanup;
2. content sync;
3. iCloud conflict-copy cleanup;
4. Astro check;
5. Astro build;
6. CSP hash verification;
7. image weight audit.

This does not replace human review, but it catches broken builds, stale CSP hashes, oversized assets, and generated-file drift before publishing.

## Related Docs

- [`docs/Vault-Workflow.md`](./Vault-Workflow.md)
- [`docs/Authoring-Guide.md`](./Authoring-Guide.md)
- [`docs/SEO.md`](./SEO.md)
- [`SECURITY.md`](../SECURITY.md)
