# jseverino.com

My personal site at [jseverino.com](https://jseverino.com). Static HTML, served from Cloudflare's edge, authored from a private notes vault.

```
Severino Labs vault  ─►  this repo  ─►  Cloudflare Pages
(private notes,          (Astro source +    (build + edge serve)
 source of truth)         public snapshot)
```

The vault is the canonical surface for pages, portfolio writeups, and the images alongside them. A sync step copies only public content into this repo, strips vault-only metadata, and produces a sanitized snapshot Cloudflare can build without ever touching the vault. The boundary between private notes and public site is enforced by one script, which makes the public surface auditable and the private surface unconstrained.

## Why it's wired this way

- **One source of truth.** Pages, writeups, and assets live in one place. No drafts in WordPress, no separate CMS copy, no paste-into-block-editor step.
- **No origin to harden.** There's no database, no admin login, no plugin update window — the entire serving layer is static HTML at the edge.
- **The private boundary is explicit.** Anything not marked `published: true` in the vault doesn't ship. Vault-only frontmatter (`doc_id`, `system`, `related_projects`, …) is stripped from the public snapshot.
- **The build needs zero vault access.** Cloudflare clones this repo, runs `npm run build`, uploads `dist/`. The vault stays on my machine.

## Stack

| Layer | Choice |
|---|---|
| Authoring | Obsidian over a private vault |
| Static generator | Astro 6 (content collections, per-page islands) |
| Hosting | Cloudflare Pages |
| Contact intake | Cloudflare Pages Functions, Turnstile, D1 |
| Operations dashboard | Django app that reads contact submissions from D1 |
| Analytics | Cloudflare Web Analytics (cookieless beacon) |
| Feeds & sitemap | `@astrojs/rss`, `@astrojs/sitemap` |

## Workflow

From anywhere, using my [personal CLI suite](https://github.com/joeseverino/tools):

```sh
site status        # repo state, dist state, content snapshot state
site sync          # vault → src/content + public/assets
site check         # astro check
site publish       # clean + sync + check + build + audit
site publish-all   # full path: hq sync, publish, commit, push (Cloudflare rebuilds)
```

Equivalent inside this repo:

```sh
npm run sync:content
npm run check
npm run publish:check
```

`publish:check` is the pre-push pipeline: clean generated output, sync from vault, run Astro diagnostics, build, verify the static CSP fallback hashes, and audit published image weight. After that, `git push` triggers the Cloudflare Pages build.

## Working in iCloud Drive

This repo lives inside an iCloud Drive folder. iCloud syncs, evicts, and
occasionally creates numbered conflict copies of files or folders it is trying
to reconcile. That is risky for the generated trees a publish touches:

- **`node_modules`** — an evicted or conflict-copied install can make
  `astro check` scan dependencies as source, which produces false errors from
  Astro's own packages.
- **`dist/`** — deleting and rewriting the built site through iCloud's file
  daemon makes builds and cleanup slow, and can leave stale output behind.

The repo handles this in two layers:

- Astro writes local build output to **`dist.nosync/`**, set by `outDir` in
  `astro.config.mjs`. Cloudflare Pages still builds to plain `dist/` because it
  sets `CF_PAGES`, so hosting behavior does not change.
- `clean:generated` removes root-level iCloud dependency conflict copies such
  as `node_modules 2`, `node_modules 3`, and `node_modules 4` before checking
  or building.
- TypeScript excludes `node_modules`, `node_modules.*`, and `node_modules *`,
  so a conflict copy cannot get treated as application source.

These generated paths are gitignored. `publish:check` runs the cleanup first,
so `site publish` and `site publish-all` should recover automatically from the
dependency conflict-copy issue.

If `node_modules` itself gets corrupted, rebuild the install:

```sh
rm -rf node_modules
npm install
```

Then run `npm run publish:check` before pushing.

## Contact flow

The contact form is static at the page level, but submissions go through a
Cloudflare Pages Function at `/api/contact`. The function validates a
Cloudflare Turnstile token, applies a small per-IP rate limit, records browser
and device context, and stores the message in Cloudflare D1.

Email notifications are intentionally not part of the public site. My private
Django operations app reads the D1-backed submissions so contact intake stays
off the static surface while still giving me a review workflow.

## Response headers and CSP

Static headers live in `public/_headers`. In production, `functions/_middleware.ts`
replaces the static CSP on HTML responses with a per-request nonce-based policy
and adds the same nonce to every script tag using Cloudflare's `HTMLRewriter`.
That keeps first-party inline scripts, Cloudflare Web Analytics, Turnstile, and
Cloudflare edge-injected scripts compatible with a strict `script-src` without
adding `'unsafe-inline'`.

The hash-based CSP in `_headers` remains as a fallback for static serving and as
an audit guard. `bin/csp-hashes.mjs` recomputes hashes from the built HTML, and
`npm run publish:check` fails if a shipped inline executable script is missing
from the fallback policy.

## Content rules

A page or writeup publishes only when its vault frontmatter says so:

```yaml
published: true
```

The card text and meta description live in frontmatter:

```yaml
description: Short card and SEO summary.
cover_image: ./images/cover.png
technologies:
  - tailscale
  - docker
featured: true
featured_order: 1
```

## Content blocks

Markdown handles prose. Custom `::` directives cover the rest, and they are
surface-specific — writeup blocks render in writeups, page blocks in pages.
`::terminal` is the only one shared by both.

### Writeup blocks

```md
::figure
![Dashboard](./images/dashboard.png)

Dashboard after enabling alerts.
::

::table
| Node | IP Address |
|------|------------|
| h1   | 10.0.0.1   |

Topology addressing used in the lab.
::

::terminal
$ site publish-all
shipped
::
```

Writeup prose also has inline image shorthand:

- `![A caption](./images/x.png)` alone on a line — the alt text becomes the
  figure caption.
- `![Alt|480|nocap](./images/x.png)` — `|`-separated options: a number sets
  pixel width, `nocap` keeps a plain image with no caption.
- A paragraph that is only a link renders as a button.

### Page blocks

```md
::buttons
- [Primary](/resume/)
- [Secondary](/contact/)
::

::button
[Single](/portfolio/)
::

::center
Centered Markdown.
::

::split
Left column.
:::
Right column.
::

::featured-projects
::

::technology-cloud
::

::contact-form
::
```

`::button sticky` renders a button pinned to the viewport; `::terminal` works
on pages too.

## Images

Source images live in the vault next to the writeup that uses them, at full
resolution. The sync step does not copy them as-is — it runs every PNG and
JPEG through `sharp` and emits, per image:

- AVIF and WebP variants at 512, 1024, and 1600 px wide (never upscaled)
- a re-encoded raster fallback at the original path, capped at 1600 px

Encoded output is cached by source-content hash under `node_modules/.cache`, so
a re-sync only re-encodes images that actually changed. Widths, formats, and
intrinsic dimensions are recorded in `src/lib/image-manifest.json`.

At render time `src/lib/images.ts` turns every manifest-known `<img>` into a
responsive `<picture>` — `<source>` for AVIF and WebP, the raster as the `<img>`
fallback, explicit `width`/`height` to reserve layout. `ProjectCard` and the
article hero use the `Picture` component directly; writeup and page bodies are
rewritten by `enhanceImages` after Markdown rendering. A browser downloads a
right-sized AVIF (tens of KB) instead of a full-resolution PNG.

## Repo boundaries

Committed:

- `src/` — Astro source
- `public/` — static assets, `_headers`, `_redirects`
- **`src/content/`, `public/assets/`, `src/lib/image-manifest.json`** — synced public snapshot and generated image variants (committed so Cloudflare can build from this repo alone)
- **`docs/SEO.md`** — technical reference for the SEO and metadata strategy
- **`docs/Authoring-Guide.md`** — manual for the custom Markdown directives and components
- **`docs/Vault-Workflow.md`** — architecture reference for the Vault-as-CMS sync logic
- **`docs/Architecture.md`** — deep dive into the technical stack, security, and image pipeline
- package and config files

Not committed:

- `node_modules`, `node_modules N` conflict copies, `dist.nosync/`, `.astro/`, `.env*`

## History

This site was on WordPress until early 2026. The migration ran in two phases: first a static mirror of the WP origin (deployed to `static.jseverino.com`) to prove Cloudflare Pages as the serving layer, then this Astro build to collapse the source of truth into the vault. The intermediate static-mirror repo is preserved as [`joeseverino/jseverino.com-legacy`](https://github.com/joeseverino/jseverino.com-legacy).
