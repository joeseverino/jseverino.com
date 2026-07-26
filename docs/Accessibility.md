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

A `@media (prefers-reduced-motion: reduce)` block at the bottom of [`src/styles/base.css`](../src/styles/base.css) collapses every animation and transition to `0.01ms` and forces `scroll-behavior: auto`. These declarations use `!important` so component-level transition selectors cannot override the user preference. Users who set the OS preference get static visuals without per-element opt-outs.

## Forced Colors

The `forced-colors: active` block preserves visible borders and focus outlines for buttons, tags, form controls, cards, navigation, and tooltips. Backdrop blur is disabled because forced-colors surfaces should remain opaque and system-controlled. Chromium emulation verifies the contact form focus and control borders in Playwright.

## Keyboard Navigation

Verified flows:

- Skip link → main content.
- Primary nav links → reachable in DOM order.
- Mobile nav toggle → opens the popover; Escape closes it; focus returns to the toggle.
- Contact form → submit triggers via Enter; status region announces result to screen readers.
- Tag pills on writeup footers → focusable, declare destination via link text.
- Mobile nav links → close the popover on activation so focus continues into the destination page.
- Theme control in the footer → each segment is a real `<button>`, reachable by tab and activated by Enter or Space.

Nothing on the site requires a pointer to operate.

## Color Theme

The site renders in light or dark. Both come from one set of dual-valued tokens in [`src/styles/base.css`](../src/styles/base.css): `:root` declares `color-scheme: light dark`, and each themeable token holds a `light-dark(light, dark)` pair. There is no dark stylesheet and no `[data-theme]` cascade to keep in sync.

Auto is the default and needs no JavaScript: with `color-scheme: light dark` set, the browser resolves every `light-dark()` token against the OS preference on its own. A visitor who never touches the control gets a working dark theme from `prefers-color-scheme` alone.

The three-state control in the footer ([`src/components/ThemeToggle.astro`](../src/components/ThemeToggle.astro)) exists only to override that. Auto, Light, and Dark are offered rather than a light/dark pair so that an explicit choice can be released back to the OS. Details:

- The control is a `role="group"` of three buttons, each carrying `aria-label` and `aria-pressed`. Segments are 28x24 CSS px, above the WCAG 2.2 target-size minimum (2.5.8).
- An explicit choice sets `color-scheme` on `<html>` and persists to `localStorage`; auto clears both.
- A blocking inline script in [`src/layouts/BaseLayout.astro`](../src/layouts/BaseLayout.astro) applies a stored choice before first paint, so an overridden theme never flashes the OS theme first. It also stamps `data-theme-mode` on `<html>`, which is what reveals the control.
- `<meta name="color-scheme" content="light dark">` sits in the head alongside that script. It duplicates the `color-scheme` in `base.css` deliberately: the stylesheet governs only once it has loaded, and until then the document scheme is `normal`, so the browser paints a white canvas with light scrollbars and form controls even on a dark-mode OS. The meta is parsed first, so the very first frame is already dark.
- With JavaScript off, the control does not render at all, because it could not do anything. Auto is unaffected.
- `<meta name="theme-color">` ships as a light and a dark pair scoped by `prefers-color-scheme`, carrying the page background for each theme (`SURFACE` in [`src/lib/brand.mjs`](../src/lib/brand.mjs), projected from `--color-bg`) so the browser toolbar blends into the page. The metas sit above the boot script in the head, and the script re-points them for an explicit choice: browsers sample `theme-color` while parsing the head, so a deferred fixup lands after it has already been read. Safari on macOS samples once per load and does not re-read on an in-place toggle; the tint corrects on the next navigation.
- The code-block and terminal palette (`--code-*`, `--term-*`) stays dark in both themes by design. It represents a real terminal, not a themeable surface.

## Color Contrast

The palette is documented in CSS custom properties at the top of [`src/styles/base.css`](../src/styles/base.css). Body text and primary surfaces target WCAG 2.1 AA (4.5:1 for normal text, 3:1 for large text) **in both themes**.

`npm run check:contrast` measures every pair below once per theme and fails the gate under 4.5:1. Measuring only the light arm was the specific regression this guards: dark values are easy to author by eye and easy to get wrong.

| Pair | Light | Dark |
|---|---|---|
| `--color-text` on `--color-bg` (body text) | 19.8:1 | 14.7:1 |
| `--color-muted` on `--color-bg` (metadata, captions, dates) | 5.2:1 | 7.5:1 |
| `--color-text-alt` on `--color-bg` | 5.8:1 | 8.4:1 |
| `--color-primary` on `--color-bg` (links, kickers) | 10.4:1 | 6.5:1 |
| `--color-text` on `--color-surface` (cards, fields) | 19.8:1 | 13.5:1 |
| `--color-muted` on `--color-surface` | 5.2:1 | 6.8:1 |
| `--color-text` on `--color-soft` (hero chip, card media) | 17.8:1 | 12.7:1 |
| `--color-muted` on `--color-soft` | 4.7:1 | 6.5:1 |
| `--color-primary` on `--color-soft` (active pills) | 9.3:1 | 5.6:1 |
| `--color-bg` on `--color-primary` (button label) | 10.4:1 | 6.5:1 |
| `--color-code-text` on `--color-code-bg` (inline code) | 17.1:1 | 12.5:1 |

Terminal label `#94a3b8` on `#111827` is ≈ 6.4:1 and identical in both themes, since that group does not recolor.

All current pairs meet AA. Add new ones to the `pairs` array in [`tests/audits/check-contrast.mjs`](../tests/audits/check-contrast.mjs) and to this table together when a component introduces a novel color-on-color combination.

## What's Intentionally Not Done

- **No accessibility statement page.** This is a personal portfolio, not a public service; the documentation in this file is the statement.
- **No separate high-contrast theme.** Light and dark both clear AA on every measured pair, so a third palette would add a surface to maintain without adding headroom. The explicit `forced-colors: active` rules preserve control boundaries and focus for users who need system-level contrast.
- **No per-theme imagery.** Writeup screenshots keep their original light or dark chrome in both themes. Swapping them would mean maintaining two of every image for a cosmetic gain.
- **No font-size scaler.** Browsers handle zoom and reflow; the layout is responsive down to 320px without horizontal scroll.

## Validation

Quick checks after layout or component changes:

```sh
npm run build:static
npm run lint:css
npm run check:css-vars
npm run check:contrast
CI=1 ASTRO_TELEMETRY_DISABLED=1 npm run test:e2e
CI=1 ASTRO_TELEMETRY_DISABLED=1 npm run test:e2e:visual -- --project=chromium-desktop
# Then in the built HTML:
# - exactly one <main id="main"> per page
# - every <img> has an alt attribute
# - every interactive element renders a visible focus state under keyboard tab
```

Playwright runs the functional accessibility and layout checks in Chromium,
Firefox, and WebKit desktop/mobile projects. Chromium on macOS owns the visual
baselines to avoid engine- and OS-specific font-rasterization noise. When an
intentional design change alters a baseline, inspect the expected, actual, and
diff images first, then run `npm run test:e2e:visual:update --
--project=chromium-desktop`. Commit the reviewed PNG changes with the frontend
change; GitHub's image diff becomes the version-to-version visual audit trail.
Never update snapshots only to make CI green. A manual keyboard pass through
the home, a portfolio article, the portfolio listing, and the contact form
remains useful before large interaction changes.

Three layers of this posture are machine-enforced on every gate run: static
WCAG contrast math over the color tokens (`npm run check:contrast`),
structural HTML over every built page — unique ids, alt on every image
(`npm run check:html`) — and an axe-core WCAG A/AA sweep over the key page
archetypes in a real browser
([`tests/playwright/a11y.single.spec.ts`](../tests/playwright/a11y.single.spec.ts)).

## Related Docs

- [`docs/SEO.md`](./SEO.md) — heading hierarchy and image alt strategy
- [`docs/Architecture.md`](./Architecture.md) — render model
- [`SECURITY.md`](../SECURITY.md) — contact form and form-field handling
