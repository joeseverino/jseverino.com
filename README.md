# jseverino.com Astro site

This repo is the public Astro build target. The Severino Labs vault is the source
of truth for editable content.

## What to edit

- Site navigation: `Severino Labs/06 Pages/_site.md`
- Technology groups: `Severino Labs/06 Pages/_technology-groups.md`
- Pages: `Severino Labs/06 Pages/<page>/index.md`
- Page images: `Severino Labs/06 Pages/<page>/images/`
- Portfolio writeups: `Severino Labs/05 Writeups/<slug>/index.md`
- Writeup images: `Severino Labs/05 Writeups/<slug>/images/`

Do not edit `dist/`. Do not hand-edit generated files in `src/content` unless you
are debugging the build. They are replaced by `npm run sync:content`.

## Page blocks

Use normal Markdown for prose. These small block directives cover the WordPress
blocks the site needs:

```md
::buttons
- [Primary Button](/resume/)
- [Secondary Button](/contact/)
::

::button
[Single Button](/portfolio/)
::

::button sticky
[Download Resume](/resume.pdf)
::

::center
Centered Markdown goes here.
::

::split
![Image](./images/example.jpg)
:::
Text for the right column.
::

::featured-projects
::

::technology-cloud
::

::contact-form
::
```

For captions, put a short paragraph immediately after the image:

```md
![Dashboard](./images/dashboard.png)

Dashboard after enabling alerts.
```

## Writeup frontmatter

The card excerpt belongs only in frontmatter:

```yaml
excerpt: >-
  Short card and SEO summary.
cover_image: ./images/cover.png
technologies:
  - tailscale
  - docker
featured: true
featured_order: 1
category: portfolio
sensitivity: public
status: active
```

Do not repeat the excerpt as the first paragraph or blockquote. The sync script
also strips exact repeated excerpts as a safety net.

## Publish

From this directory:

```sh
npm run publish:check
```

Or, from anywhere after installing the tools suite:

```sh
site publish
```

That runs:

1. `npm run sync:content`
2. `npm run check`
3. `npm run build`
4. `npm run audit:assets`

Then commit and push the site repo. Cloudflare Pages clones this repo, runs the
build command, and uploads `dist/`.

## Images

Keep source screenshots beside the markdown in `images/`. The sync script only
copies images that are actually referenced by markdown/frontmatter, so unused
large originals can stay in the vault without shipping to Cloudflare.

Use `npm run audit:assets` to list large published images. If a referenced image
is still huge, replace it in the vault with a smaller exported copy and update
the markdown path.
