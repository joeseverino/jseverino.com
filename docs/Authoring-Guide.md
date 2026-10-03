# Authoring Guide

Content is written in the private vault as Markdown. The sync copies only published content into this repo. [`src/lib/markdown.ts`](../src/lib/markdown.ts) renders it with standard Markdown plus a small set of custom directives, and [`src/lib/image-directives.ts`](../src/lib/image-directives.ts) parses the image modifiers. [`src/lib/content.ts`](../src/lib/content.ts) is the Astro glue: content collections and `<picture>` enhancement.

Use this guide when writing or reviewing vault content.

## Which Directives Work Where

Pages and writeups render through two pipelines, and each recognizes its own directives:

| Pipeline | Block directives | Inline directives |
| --- | --- | --- |
| Pages (`06 Pages`) | `::button`, `::button sticky`, `::buttons`, `::terminal`, `::center`, `::split`, `::hero` | `::cta ::`, `::featured-projects ::`, `::technology-cloud ::` |
| Writeups (`05 Writeups`) | `::terminal`, `::figure`, `::table` | none |

A block opens with `::name` on its own line and closes with `::` on its own line. A directive the pipeline does not recognize, or a typo such as `::termnial`, stays in the page as literal text, and the HTML audit (`npm run check:html`) fails the build on it.

## General Rules

- Keep frontmatter factual and public-safe.
- Set `published: true` only when the page or writeup is ready to ship.
- Put writeup images in the writeup's local `images/` folder.
- Reference local images as `./images/file.png`.
- Start writeup body sections at `##`; the article title is already rendered as the page `h1`.
- Prefer normal Markdown unless a directive adds real structure.
- Do not rely on raw HTML unless there is a specific reason. See [Raw HTML](#raw-html) for what survives.

## Image Syntax

Standard image:

```md
![Screenshot of the final dashboard](./images/dashboard.png)
```

The alt text is used as the visible caption when the image is promoted to a figure.

Width override:

```md
![Packet capture showing ARP replies|720](./images/arp-replies.png)
```

No visible caption:

```md
![Joe Severino portrait|nocap](./images/portrait.jpg)
```

Opt out of the zoom view:

```md
![Decorative divider|nozoom](./images/divider.svg)
```

Every image in a writeup body opens an enlarged zoom view on click or tap by
default. Add `|nozoom` to keep a specific image static; it still renders
normally. The `|nozoom` modifier also works inside `::figure` blocks.

The caption, `|nocap`, and `|nozoom` modifiers apply to writeups. On pages, only the width modifier (`|720`) is read.

The sync generates responsive variants. `enhanceImages()` in [`src/lib/images.ts`](../src/lib/images.ts) renders AVIF, WebP, and fallback sources with stable dimensions from [`src/lib/image-manifest.json`](../src/lib/image-manifest.json).

## Terminal Blocks

Use terminal blocks for command/output sequences.

```md
::terminal
$ npm run publish:check
check      0 errors, 0 warnings
build      76 pages built
::
```

Lines beginning with `$` are rendered as commands. Other lines are rendered as output.

## Buttons

Pages only.

Single button:

```md
::button
[View Resume](/resume/)
::
```

Sticky button:

```md
::button sticky
[Download PDF](/assets/resume.pdf)
::
```

Button row:

```md
::buttons
- [View Portfolio](/portfolio/)
- [Contact Me](/contact/)
::
```

Standard CTA:

```md
::cta ::
```

The standard CTA expands to a `::buttons` row: View Portfolio and Get in Touch.

A writeup paragraph that is nothing but one link is promoted to a button automatically.

## Centered Content

Pages only. Use sparingly for short page-opening text.

```md
::center
Cybersecurity and networking projects.
::
```

## Split Layout

Pages only. Use a split layout for two-column page sections.

```md
::split
Left column content.
:::
Right column content.
::
```

The `:::` line separates the two columns.

## Hero

Wraps the home-page hero in a centered `<header>`. Use once, at the top of the home page.

```md
::hero
<p class="hero-eyebrow">Cybersecurity • Networking • AI</p>

# Hi, I'm Joe Severino

Role • Credentials

<p class="hero-summary">One-line summary of the work.</p>

<p class="hero-location">City, State</p>

::buttons
- [View My Resume](/resume/)
- [Get in Touch](/contact/)
::
::
```

The `hero-eyebrow`, `hero-summary`, and `hero-location` classes style the kicker, the lead summary, and the location chip.

## Dynamic Page Blocks

Pages only.

Featured projects:

```md
::featured-projects ::
```

Technology cloud:

```md
::technology-cloud ::
```

Both are placeholders the page layout fills from structured content. Featured projects come from writeup frontmatter (`featured`, `featured_order`). Technology groups come from [`src/content/technology-groups.md`](../src/content/technology-groups.md), synced from the vault catalog.

## Figure Blocks

Writeups only. Use figure blocks when a caption needs Markdown or multiple lines.

```md
::figure
![Nftables host filter](./images/nftables.png)
The host firewall accepts SSH only from the VPN interface.
::
```

## Table Blocks

Writeups only. Use table blocks when a table needs a caption.

```md
::table
| Control | Purpose |
| --- | --- |
| Turnstile | Bot challenge |
| D1 | Contact messages and CSP reports |

Contact form controls.
::
```

Tables are wrapped for horizontal scrolling on small screens, and separator-delimited values (IPs, MACs) break at their `.` and `:` separators.

## Raw HTML

Raw HTML is rebuilt from an allow-list in [`src/lib/markdown.ts`](../src/lib/markdown.ts):

- Tags: `a`, `abbr`, `b`, `blockquote`, `br`, `caption`, `code`, `dd`, `del`, `div`, `dl`, `dt`, `em`, `figcaption`, `figure`, `h1` to `h6`, `header`, `hr`, `i`, `img`, `kbd`, `li`, `mark`, `ol`, `p`, `pre`, `s`, `small`, `span`, `strong`, `sub`, `sup`, `table`, `tbody`, `td`, `tfoot`, `th`, `thead`, `tr`, `u`, `ul`, `wbr`.
- Attributes on any of them: `class`, `title`, `aria-hidden`, `aria-label`. Per tag: `a` keeps `href`, `target`, `rel`; `img` keeps `src`, `alt`, `width`, `height`, `loading`, `decoding`; `ol` keeps `start`; `td`/`th` keep `colspan`, `rowspan` (`th` also `scope`).
- URLs in `href` and `src` must be relative or `http`, `https`, or `mailto`; any other scheme drops the attribute.

Any other tag renders as visible text, and HTML comments are dropped.

## Review Checklist

Before publishing:

- The page or writeup has `published: true`.
- The title and description are public-safe.
- Images use local relative paths.
- Captions are descriptive.
- No private hostnames, keys, internal notes, or vault metadata appear in body content.
- `npm run publish:check` passes after sync (see [`docs/Release-Checklist.md`](./Release-Checklist.md)).

## Related Docs

- [`docs/Vault-Workflow.md`](./Vault-Workflow.md)
- [`docs/Site-CLI.md`](./Site-CLI.md)
- [`docs/WordPress-To-Astro-Migration.md`](./WordPress-To-Astro-Migration.md)
- [`docs/Architecture.md`](./Architecture.md)
- [`docs/SEO.md`](./SEO.md)
- [`docs/Accessibility.md`](./Accessibility.md)
