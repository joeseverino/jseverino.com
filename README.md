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
| Static generator | Astro 5 (content collections, per-page islands) |
| Hosting | Cloudflare Pages |
| Analytics | GA4, gated by `PUBLIC_GA_MEASUREMENT_ID`, production-only |
| Feeds & sitemap | `@astrojs/rss`, `@astrojs/sitemap` |

## Workflow

From anywhere, using my [personal CLI suite](https://github.com/joeseverino/tools):

```sh
site status        # repo state, dist state, content snapshot state
site sync          # vault → src/content + public/assets
site check         # astro check
site publish       # clean + sync + check + build + audit
site publish-all   # full path: hq sync, publish, push (Cloudflare rebuilds)
```

Equivalent inside this repo:

```sh
npm run sync:content
npm run check
npm run publish:check
```

`publish:check` is the pre-push pipeline: clean generated output, sync from vault, run Astro diagnostics, build, audit published image weight. After that, `git push` triggers the Cloudflare Pages build.

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

Don't repeat the description as the body's first paragraph; the sync script strips exact duplicates as a safety net.

## Page blocks

Markdown handles prose. These directives cover the custom blocks:

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
![Image](./images/example.jpg)
:::
Right-column text.
::

::featured-projects
::

::technology-cloud
::

::contact-form
::
```

For a portfolio image with a caption, use an explicit figure block:

```md
::figure
![Dashboard](./images/dashboard.png)

Dashboard after enabling alerts.
::
```

For a table with a caption, use an explicit table block:

```md
::table
| Node | IP Address |
|------|------------|
| h1   | 10.0.0.1   |

Topology addressing used in the lab.
::
```

## Repo boundaries

Committed:

- `src/` — Astro source
- `public/` — static assets, `_headers`, `_redirects`
- `src/content/` — synced public snapshot (committed so Cloudflare can build from this repo alone)
- package and config files

Not committed:

- `node_modules/`, `.astro/`, `dist/`, `.env*`

## History

This site was on WordPress until early 2026. The migration ran in two phases: first a static mirror of the WP origin (deployed to `static.jseverino.com`) to prove Cloudflare Pages as the serving layer, then this Astro build to collapse the source of truth into the vault. The intermediate static-mirror repo is preserved as [`joeseverino/jseverino.com-legacy`](https://github.com/joeseverino/jseverino.com-legacy).
