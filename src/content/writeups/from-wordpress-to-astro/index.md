---
title: 'From WordPress to Astro: Building a Static Publishing System for jseverino.com'
description: >-
  Why jseverino.com left WordPress for static Astro on Cloudflare Pages: lighter
  pages, less attack surface, and a one-command publish flow behind a full test
  gate.
published: true
published_at: 2026-06-17T00:00:00.000Z
last_reviewed: 2026-06-17T00:00:00.000Z
cover_image: ./images/pagespeed-perfect-scores-cover.png
cover_alt: >-
  Google PageSpeed Insights reporting 100 for Performance, Accessibility, Best
  Practices, and SEO on jseverino.com.
technologies:
  - astro
  - cloudflare-pages
  - cloudflare
  - wordpress
  - typescript
  - markdown
featured: true
featured_order: 1
---

# From WordPress to Astro: Building a Static Publishing System for jseverino.com

![Google PageSpeed Insights reporting 100 for Performance, Accessibility, Best Practices, and SEO on jseverino.com.](/assets/writeups/from-wordpress-to-astro/images/pagespeed-perfect-scores-cover.png)

## Overview

I built jseverino.com on WordPress in August 2025. WordPress is my default. I have been making sites with it since I was 14. But this site has no comments, no uploads, and no accounts. Almost every page is text and screenshots I write once and rarely touch, and WordPress was still booting PHP and querying MySQL to rebuild the same HTML on every visit.

In May 2026 I moved it to a static [Astro](https://astro.build) build on [Cloudflare Pages](https://pages.cloudflare.com). I write each article as markdown, a sync script pulls it into the repo, Astro builds plain HTML once, and Cloudflare serves it from the edge. No database, no plugins, nothing dynamic where the public can reach it. The result is a site that is faster, smaller, and far simpler to run.

## Why WordPress Was the Wrong Fit

Nothing was wrong with WordPress. It was wrong for this site. A WordPress install runs a database, a PHP runtime, a theme, and a stack of plugins, all of it live on every request. That is worth it when a site has logins, comments, or someone publishing through a browser. This site has none of that. It is a portfolio and a writing archive. The pages barely change, and every visitor should get the same HTML.

So I was carrying a CMS I never used. There was a public admin login to defend, plugin and theme code running in production, an upload endpoint, and a database that had to stay healthy just so someone could read a static article. All of that is surface area, and none of it was earning its place.

## What Replaced It

The new site is a snapshot. I write each article as markdown in a private vault, then run a sync script that copies it into the public repo. The script is allowlisted, so it only forwards the fields the public site is allowed to show and the images an article actually uses. Draft notes and private metadata never leave my machine.

::figure
![Before and after request flow. Before: Browser to Cloudflare to WordPress and PHP to MySQL to theme and plugins. After: Markdown to sync script to Astro build to Cloudflare Pages to Browser.](/assets/writeups/from-wordpress-to-astro/images/before-after.png)

Before, every request ran through PHP, MySQL, and the theme and plugin layer. After, the page is built once and Cloudflare serves a static file.
::

Astro builds every page to a file ahead of time, and Cloudflare serves those files. There is no runtime to keep alive. The only dynamic pieces left are two small Cloudflare functions, the [contact form](https://github.com/joeseverino/jseverino.com/blob/main/functions/api/contact.ts) and a [security report collector](https://github.com/joeseverino/jseverino.com/blob/main/functions/api/csp-report.ts), each a single file I can read top to bottom.

## Why It's Better

| | WordPress | Astro (static) |
| --- | --- | --- |
| Public runtime | PHP, MySQL, theme, plugins | Static files on the edge |
| Admin surface | A login to defend | None |
| A heavy article | 20.2 MB, 34 requests | 1.3 MB, 29 requests |
| Maintenance | Core and plugin updates | None |
| Rolling back | Restore the database | `git revert` |

**It is faster and a lot lighter.** Loading the same Custom Detection Engine writeup in a browser pulled 20.2 MB over the wire on WordPress. On Astro it transfers 1.3 MB, roughly 15 times lighter, almost all of the difference being images. Time to first byte fell too, from about 0.96 s to 0.34 s on an article page and 0.83 s to 0.26 s on the homepage. PageSpeed Insights scores the site 100 across Performance, Accessibility, Best Practices, and SEO on desktop, and within a point of that on mobile.

::figure
![Safari Network panel comparison of the same Custom Detection Engine article. On WordPress the page transfers 20.2 MB across 34 requests, dominated by PNG screenshots of one to two megabytes each. On Astro the same article transfers 1.30 MB across 29 requests, served as AVIF images measured in kilobytes.](/assets/writeups/from-wordpress-to-astro/images/payload-wordpress-vs-astro.png)

Same article, same browser, cold load. WordPress pulled 20.2 MB of full-size PNGs. The Astro build serves 1.3 MB of responsive AVIF.
::

**It is smaller and safer.** There is no public admin login, no plugin or theme code running in production, no upload endpoint, and no database serving readers. The site sends a [strict content security policy](https://github.com/joeseverino/jseverino.com/blob/main/functions/_middleware.ts) that never falls back to inline scripts, and it passes Google's CSP checker clean.

**It is reviewable.** The public repository is the site, and I wrote the whole stack, so what runs is a small codebase anyone can read in a sitting. What ships is exactly what is in the commit. WordPress hid that behavior across a database, a theme, and a dozen plugins no one could audit at a glance. Each change also goes out as its own Cloudflare preview deployment, so I can review the real page before it is live.

**It is simpler to run.** There are no plugin updates, no core update windows, and no live admin panel to keep healthy. Every deploy is a build artifact, so going back is a single `git revert`.

## Publishing Now

Publishing used to mean clicking a button in an admin panel against a live database. Now it is a short flow I own end to end. One command scaffolds a draft in the vault:

```bash
site new-writeup <slug>
```

I write the article in Obsidian, fill in the frontmatter and body, and set `published: true` when it is ready. Then one command ships it:

```bash
site publish
```

`site publish` takes no arguments. It works out what changed, runs the [full gate](https://github.com/joeseverino/jseverino.com/blob/main/tests/README.md), builds the site, ships it, and verifies it on the live URL. If a check fails it stops before anything reaches production and says exactly what to fix.

::figure
![The site diagnose command running the full gate across four phases. Every check passes, ending with "ALL CHECKS PASSED in 60s. Codebase is logically clean and ready to deploy." The checks include security signatures, WCAG color contrast, schema parity, the unit and Playwright test suites, a production build, asset-weight and page-weight budgets, structural HTML, and SEO metadata.](/assets/writeups/from-wordpress-to-astro/images/validation-gate.png)

The gate behind `site publish`: over 100 tests, including a Playwright sweep across six browser profiles. Nothing deploys unless every one passes.
::

Or I skip the commands. The same workflow is a terminal app, where the dev server, the audit gate, the Playwright test suite, a signed build, and the publish-and-verify step are each one keystroke.

::figure
![The site manage terminal app on its Site tab, showing live system status with a clean git tree, a signed build, and the live site returning HTTP 200, alongside one-key actions for the dev server, the audit gate, the Playwright test suite, a build, and a publish step described as doctor, build, commit, push, and live verify.](/assets/writeups/from-wordpress-to-astro/images/site-manage-tui.png)

The same steps as one-key actions: live status up top, then the audit gate, the test suite, and a publish that builds, ships, and verifies production.
::

[View tools on GitHub](https://github.com/joeseverino/tools)
## What's Next

The migration is finished, so the project now is the system itself rather than a CMS to maintain. The work from here is making the path from a draft to a verified deploy shorter, and keeping the gate that guards it tight as the site grows.

Two tools that came out of building this site have become their own npm packages, and they are where that effort goes next: [sitedrift](https://github.com/joeseverino/sitedrift), the visual review layer that diffs a preview deploy against production before a change ships, and [branding-engine](https://github.com/joeseverino/branding-engine), the brand-as-data system that generates the design tokens the site is styled from.

WordPress still earns its place on a site that genuinely needs a CMS. This one does not, and I do not see that changing. Static files plus this toolchain already beat it here on speed, safety, and how little I have to think about.

[View the source on GitHub](https://github.com/joeseverino/jseverino.com)
