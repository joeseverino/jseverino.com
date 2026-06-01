# Accessibility

This site treats accessibility as a property of the rendered HTML and CSS, not as a layer bolted on later. The posture is documented here so future changes don't quietly regress it.

## Document Structure

- `<html lang="en-US">` declares the document language for screen readers and translation services. Set in [`src/layouts/BaseLayout.astro`](../src/layouts/BaseLayout.astro).
- Every route renders a single `<main id="main">`. The skip link and analytics tools assume exactly one main landmark per page.
- Headings start at `<h1>` (page title or writeup title) and descend. Writeup bodies start at `<h2>` because the article shell already renders the title as `h1`. See [`docs/SEO.md`](./SEO.md#heading-hierarchy).

## Skip Link

`BaseLayout.astro` renders a `<a class="skip-link" href="#main">` as the first focusable element on every page. The element is visually translated off-screen by default and slides into view when it receives focus, satisfying WCAG 2.4.1 (Bypass Blocks) without permanently consuming layout. Style in [`src/styles/base.css`](../src/styles/base.css) under `.skip-link`.

## Landmarks And ARIA

- Primary navigation: `<nav aria-label="Primary navigation">` in [`src/components/Header.astro`](../src/components/Header.astro).
- Mobile navigation: `<nav aria-label="Mobile navigation">` with `popover="auto"` so the browser handles focus trap, escape-to-dismiss, and outside-click.
- Active nav item: `aria-current="page"` on the matching link.
- Contact form: `role="status" aria-live="polite"` on the submit-result region so screen readers announce success or failure without stealing focus.
- Decorative SVGs (social icons, defs sheet): `aria-hidden="true" focusable="false"`. Each social *link* declares its destination via `aria-label`, since the icon itself carries no accessible name.

## Image Alt Text

Cover images carry `cover_alt` in writeup frontmatter. The site sync mirrors it to `writeup.heroAlt`, and both the `ProjectCard` listing and the article hero `<figure>` use that string as the `<img alt>`. When `cover_alt` is empty the title is used as a fallback so no image ever renders without alt text. `prepare_writeup_publish` in the vault MCP nags about missing `cover_alt` so drafts don't ship with duplicated-title alts.

Body images use the alt text from the markdown source. The `![|width|nocap]` directive in [`src/lib/content.ts`](../src/lib/content.ts) only modifies layout — the alt text itself is preserved verbatim into the rendered `<img>`.

Decorative-only images should use `alt=""`, never omit the attribute. Currently no images on the site use this case.

## Focus Management

Visible focus is preserved on every interactive element. Custom focus styles live next to their components in [`src/styles/base.css`](../src/styles/base.css): `.skip-link`, `.brand`, `.nav-link`, `.archive-tag`, `.page-actions a`, and others. The site uses `:focus` rather than `:focus-visible`, meaning focus rings render on mouse interaction as well as keyboard — intentional, since the cost is cosmetic and the benefit is that low-vision mouse users still see the focused control.

Mobile navigation uses the native `popover` API. The browser handles focus restoration when the popover closes, eliminating a class of bugs around losing focus to an unmounted element.

## Reduced Motion

A `@media (prefers-reduced-motion: reduce)` block at the bottom of [`src/styles/base.css`](../src/styles/base.css) collapses every animation and transition to `0.01ms` and forces `scroll-behavior: auto`. Users who set the OS preference get static visuals without the site needing per-element opt-outs.

## Keyboard Navigation

Verified flows:

- Skip link → main content.
- Primary nav links → reachable in DOM order.
- Mobile nav toggle → opens the popover; Escape closes it; focus returns to the toggle.
- Contact form → submit triggers via Enter; status region announces result to screen readers.
- Tag pills on writeup footers → focusable, declare destination via link text.
- Mobile nav links → close the popover on activation so focus continues into the destination page.

Nothing on the site requires a pointer to operate.

## Color Contrast

The primary palette is documented in CSS custom properties at the top of [`src/styles/base.css`](../src/styles/base.css). Body text and primary surfaces target WCAG 2.1 AA (4.5:1 for normal text, 3:1 for large text).

Spot-checked combinations on the live palette:

- `--color-text` on `--color-bg` (default body text): ≈ 18:1
- `--color-muted` on `--color-bg` (card metadata, captions, dates): ≈ 5.2:1
- `--color-text` on `--color-soft` (hero chip, card media surface): ≈ 17:1
- Terminal label `#94a3b8` on `#111827`: ≈ 6.4:1
- Success status `#166534` on `rgba(22,101,52,0.1)` over white: ≈ 6:1

All current pairs meet AA. Update this list when a new component introduces a novel color-on-color combination.

## What's Intentionally Not Done

- **No accessibility statement page.** This is a personal portfolio, not a public service; the documentation in this file is the statement.
- **No high-contrast theme toggle.** The single dark palette is the design intent. OS-level inversion and forced-colors mode (`forced-colors: active`) are respected by the underlying CSS without custom theming.
- **No font-size scaler.** Browsers handle zoom and reflow; the layout is responsive down to 320px without horizontal scroll.

## Validation

Quick checks after layout or component changes:

```sh
npm run build:static
# Then in the built HTML:
# - exactly one <main id="main"> per page
# - every <img> has an alt attribute
# - every interactive element renders a visible focus state under keyboard tab
```

A manual keyboard pass through the home, a portfolio article, the portfolio listing, and the contact form covers the surfaces most likely to regress.

## Related Docs

- [`docs/SEO.md`](./SEO.md) — heading hierarchy and image alt strategy
- [`docs/Architecture.md`](./Architecture.md) — render model
- [`SECURITY.md`](../SECURITY.md) — contact form and form-field handling
