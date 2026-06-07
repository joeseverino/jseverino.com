# Deployment Preview Review

Every non-production Cloudflare Pages deployment of `jseverino.com` carries a
compact [sitedrift](https://github.com/joeseverino/sitedrift) review layer. The
preview deployment is DEV; the current `https://jseverino.com` release is LIVE.
This turns each branch URL into a review environment instead of a standalone
copy that must be compared manually.

## What Reviewers Get

- **Solo** view by default, with one-click switching between DEV and LIVE.
- **Split** view with synchronized routes, links, and scrolling.
- **Overlay** and pixel-difference modes for visual drift.
- Per-side HTTP status plus response, DOM-ready, load, transfer, header, and
  delta details.
- A Google-style SEO preview for both sides.
- Metadata comparison for title, description, and canonical URL.
- SEO checks for title and description quality, H1 count, canonical, viewport,
  language, Open Graph metadata, indexing directives, favicon, and image alt
  coverage.
- Review notes stored only in that browser's `localStorage`.

The status and SEO panels are diagnostics, not synthetic performance
benchmarks. Their value is fast same-route comparison under the same browser
session.

## Repository Integration

The project has two integration points. The static build ends with:

```json
{
  "scripts": {
    "build:static": "ASTRO_TELEMETRY_DISABLED=1 astro build && sitedrift cloudflare --dir dist --live https://jseverino.com --brand \"Joe Severino\""
  }
}
```

The scoped Pages Function is:

```ts
// functions/__sitedrift/[[path]].ts
export { onRequest } from 'sitedrift/cloudflare';
```

`sitedrift` is pinned in `devDependencies` and the exact tarball is locked in
`package-lock.json`.

## Preview Build Flow

```text
feature branch push
  -> Cloudflare Pages sets CF_PAGES=1 and CF_PAGES_BRANCH=<branch>
  -> Astro writes dist/
  -> sitedrift preserves each generated HTML page
  -> sitedrift replaces the public preview page with its review shell
  -> /__sitedrift/dev/* serves the preserved preview
  -> /__sitedrift/live/* reads the matching production route
```

The branch alias and immutable deployment URL expose the same review interface.
The immutable URL is preferred for verification because it cannot move to a
newer build during testing.

## Production Invariant

The addon does not wrap production. `sitedrift cloudflare` exits without
changing the Astro output when `CF_PAGES_BRANCH=main`.

Cloudflare bundles the `functions/` tree separately, so the exported Function
still exists in production. The required generated configuration is absent,
therefore `/__sitedrift/*` fails closed with `404`. The normal site, contact
form, CSP report receiver, middleware, headers, and static assets follow their
existing production paths unchanged.

Run the project-level guard before release:

```sh
npm run check:preview
```

It builds small simulated outputs and asserts that a feature branch receives
the review wrapper while `main` remains the original Astro document.

## Security Boundary

- The Function owns only `/__sitedrift/*`.
- It allows only `GET` and `HEAD`.
- The LIVE destination is fixed at build time to `https://jseverino.com`.
- It does not forward contact-form writes or arbitrary origins.
- Hosted frames execute trusted first-party preview code so the deployed site
  remains interactive.
- Notes never leave the browser and are not available through the sitedrift MCP.
- Existing CSP middleware and application Functions retain their routes.
- Pages preview hostnames remain excluded from indexing through
  `X-Robots-Tag: noindex`.

This adds a read-only preview review surface. It does not add an account system,
production content API, database binding, secret, upload endpoint, or public
write path.

## Review Procedure

1. Open the immutable `########.jseverino.pages.dev` deployment.
2. Confirm DEV Solo mode renders the intended branch.
3. Switch DEV/LIVE and inspect the same route.
4. Use Split with linked scrolling for layout and content review.
5. Use Overlay/Diff for pixel-level changes.
6. Open each status badge and review response/load deltas.
7. Open SEO and compare title, description, canonical, snippet, and checks.
8. Check navigation, menus, scrolling, desktop Chromium, and mobile WebKit.
9. Keep browser-local notes free of sensitive information.
10. Confirm the production guard before merging to `main`.

## Dependency Updates

```sh
npm install --save-dev 'sitedrift@^<version>'
npm run check
npm run check:preview
```

Review upstream release notes and verify an immutable Pages deployment before
merging. Because preview HTML is transformed at build time and the proxy runs at
the edge, sitedrift updates are both build-tooling and preview-runtime changes.

## Related Docs

- [Architecture](./Architecture.md)
- [SEO And Metadata](./SEO.md)
- [Release Checklist](./Release-Checklist.md)
- [Security](../SECURITY.md)
