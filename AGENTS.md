# jseverino.com for agents

This is the public Astro build source for `jseverino.com`. The private vault is
the editorial source of truth; do not hand-edit synced content when the change
belongs in the vault.

## Required checks

```sh
npm run check
npm run check:preview
```

Before a production push, run:

```sh
npm run publish:check
```

Frontend changes also require the Playwright visual gate documented in
`docs/Release-Checklist.md`.

## Cloudflare preview review

Non-production Cloudflare Pages builds are wrapped by the `sitedrift`
development dependency:

```sh
astro build &&
sitedrift cloudflare --dir dist --live https://jseverino.com --brand "Joe Severino"
```

The scoped Function is `functions/__sitedrift/[[path]].ts`.

Invariants:

- The wrapper activates only when `CF_PAGES=1` and `CF_PAGES_BRANCH` is not
  `main`.
- Production HTML must remain ordinary Astro output.
- Production `/__sitedrift/*` must return `404`.
- The proxy permits only `GET` and `HEAD`.
- The LIVE origin stays fixed to `https://jseverino.com`.
- Contact, CSP reporting, middleware, D1, and Turnstile behavior are unrelated
  and must not be routed through sitedrift.
- Hosted notes are browser-local and unavailable to MCP.

Run `npm run check:preview` after any change to the build command, Pages branch
logic, dependency version, or `functions/__sitedrift/`.

Use the immutable `########.jseverino.pages.dev` deployment for browser
verification. Review Solo/Split/Overlay/Diff, linked navigation and scrolling,
status deltas, SEO checks, desktop Chromium, and mobile WebKit.

Full documentation: `docs/Deployment-Preview-Review.md`.

## Content workflow

For writeup frontmatter, featured order, technology tags, or publish readiness,
use the severino-vault MCP tools. Do not edit writeup YAML or the technology
catalog by hand.
