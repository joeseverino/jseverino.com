# Authoring Guide

Content is written in the private vault as Markdown with
[directives](https://talk.commonmark.org/t/generic-directives-plugins-syntax/444).
The sync copies published documents into this repo as MDX, and Astro renders
them with its Rust Markdown processor, Sätteri, and the site's plugins in
[`src/lib/markdown/`](../src/lib/markdown/). Images go through Astro's image
pipeline.

Use this guide when writing or reviewing vault content.

## Blocks

A block opens with `:::name` on its own line and closes with `:::`. Every block
works in pages and writeups alike.

| Block | Renders |
| --- | --- |
| `:::figure` | an image with a caption |
| `:::table` | a table with a caption |
| `:::button` | one action button; `:::button{.sticky}` keeps it pinned |
| `:::buttons` | a row of buttons from a list of links |
| `:::center` | centered text |
| `:::hero` | the home-page hero |
| `:::split` with two `:::side` | a two-column section |

A block inside another needs a longer fence on the outside: give the parent
one more colon than the tallest block it holds.

```md
::::hero
# Hi, I'm Joe Severino

:::buttons
- [View My Resume](/resume/)
- [Get in Touch](/contact/)
:::
::::
```

A name that is not a block, or a typo such as `:::figrue`, fails the build
with its line. `site validate` reports it before anything syncs.

## General Rules

- Keep frontmatter factual and public-safe.
- Set `published: true` only when the page or writeup is ready to ship.
- Keep a document's images in its `images/` folder and reference them as
  `./images/file.png`.
- Start writeup body sections at `##`; the article title is already the page `h1`.
- Prefer plain Markdown unless a block adds real structure.

## Writing MDX

Documents compile as MDX, so content follows its rules. `site validate`
reports a problem with its line before the build would.

- A literal brace needs a backslash: `\{` and `\}`. An unescaped `{…}` is an
  expression, and content cannot run code.
- A literal `<` before a letter needs `&lt;`, or belongs in code. Anything
  inside backticks or a fenced block is literal already.
- HTML comments do not compile. Leave notes out of published documents.
- A `:::` line directly after a table becomes a table row. Leave a blank line
  between a table and the fence that closes its block.

## Images

```md
![Screenshot of the final dashboard](./images/dashboard.png)
```

Modifiers go after the alt text, separated by `|`:

```md
![Packet capture showing ARP replies|720](./images/arp-replies.png)
![Decorative divider|nozoom](./images/divider.png)
```

- A number sets the display width; the height follows the image's ratio.
- `nozoom` keeps the image out of the zoom view a writeup image opens on click.

The sync writes each image's master beside its document: at most 1600 pixels
wide, converted to sRGB, with every metadata block (EXIF, XMP, ICC) removed.
Astro encodes AVIF and WebP at 512, 768, 1024, and 1600 pixels from it, with
the intrinsic size on every `<img>` so nothing shifts as it loads.

## Figures

```md
:::figure
![Nftables host filter](./images/nftables.png)
The host firewall accepts SSH only from the VPN interface.
:::
```

The caption is everything after the image: the lines right below it, or the
paragraphs after a blank line. It takes inline Markdown.

## Tables

```md
:::table
| Control | Purpose |
| --- | --- |
| Turnstile | Bot challenge |
| D1 | Contact messages and CSP reports |

Contact form controls.
:::
```

Every table scrolls sideways on small screens, with or without the block.
Separator-delimited values (IPs, MACs) break at their `.` and `:`.

## Terminal Output

A fenced block tagged `terminal` renders as a terminal:

````md
```terminal
$ npm run publish:check
check      0 errors, 0 warnings
build      93 pages built
```
````

Lines starting with `$` render as commands, the rest as output. The content is
literal, so `<placeholders>` need no escaping.

## Buttons

```md
:::button
[View Resume](/resume/)
:::

:::buttons
- [View Portfolio](/portfolio/)
- [Contact Me](/contact/)
:::
```

In a row the first button is primary and the rest secondary. In a writeup, a
paragraph that is only a link renders as a button too.

## Split Sections

```md
::::split
:::side
![Portrait|340](./images/portrait.jpg)
:::
:::side
The text column.
:::
::::
```

A side that holds only an image renders the image bare.

## Placeholders

A page places a site component on a line of its own:

```md
::featured-projects
::technology-cloud
::contact-form
```

The page renders each one, and every run of prose between them in its own
wrapper. Featured projects come from writeup frontmatter (`featured`,
`featured_order`); technology groups from
[`src/content/technology-groups.md`](../src/content/technology-groups.md), synced
from the vault catalog.

## Raw HTML

Raw HTML is limited to an allow-list, enforced by
[`src/lib/markdown/guard.ts`](../src/lib/markdown/guard.ts). Anything outside it
fails the build:

- Tags: `a`, `abbr`, `b`, `blockquote`, `br`, `caption`, `code`, `dd`, `del`,
  `div`, `dl`, `dt`, `em`, `figcaption`, `figure`, `h1` to `h6`, `header`, `hr`,
  `i`, `img`, `kbd`, `li`, `mark`, `ol`, `p`, `pre`, `s`, `small`, `span`,
  `strong`, `sub`, `sup`, `table`, `tbody`, `td`, `tfoot`, `th`, `thead`, `tr`,
  `u`, `ul`, `wbr`.
- Attributes on any of them: `class`, `title`, `aria-hidden`, `aria-label`. Per
  tag: `a` takes `href`, `target`, `rel`; `img` takes `src`, `alt`, `width`,
  `height`, `loading`, `decoding`; `ol` takes `start`; `td`/`th` take
  `colspan`, `rowspan` (`th` also `scope`).
- Attribute values are plain strings, and URLs in `href` and `src` are relative
  or `http`, `https`, or `mailto`.

## Review Checklist

Before publishing:

- The page or writeup has `published: true`, and a writeup has a `cover_image`.
- The title and description are public-safe.
- Images use local relative paths and captions are descriptive.
- No private hostnames, keys, internal notes, or vault metadata appear in body
  content.
- `site validate` passes, then `npm run publish:check` after the sync (see
  [Release Checklist](./Release-Checklist.md)).

## Related Docs

- [Vault Workflow](./Vault-Workflow.md)
- [Site CLI](./Site-CLI.md)
- [Architecture](./Architecture.md)
- [SEO](./SEO.md) · [Accessibility](./Accessibility.md)
