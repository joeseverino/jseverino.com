# Blueprint Setup

This repo is the reference implementation behind a future site blueprint. This
file is the single inventory of everything that is *instance-specific* — the
values a new site built from this codebase must change. Two kinds exist:

1. **Importable** — single sources that the rest of the code derives from. Edit
   the source; every consumer updates automatically.
2. **Residue** — static text in files that cannot `import` (deploy manifests,
   signed files, external dashboards). These must be changed by hand.

## 1. Importable single sources

| File | Holds | Consumers |
| --- | --- | --- |
| [`src/lib/site-config.mjs`](../src/lib/site-config.mjs) | `domain`, `owner`, `github`, `d1` | `site.ts`, `astro.config.mjs`, `bin/*`, `tests/audits/*`, `security-txt.mjs` |
| [`src/lib/brand.mjs`](../src/lib/brand.mjs) | brand color tokens + `JS` glyph | `BaseLayout`, `brand.css.ts`, `bin/make-*` |
| [`src/lib/site.ts`](../src/lib/site.ts) | editorial chrome: `jobTitle`, `summary`, `skills`, `socialLinks`, `navItems` | `Header`, `Footer`, `SeoHead` |
| [`src/lib/build-output.mjs`](../src/lib/build-output.mjs) | the build outDir decision (write side) + built-dir resolution (read side) | `astro.config.mjs`, `bin/build-static.mjs`, `bin/seo-preview.mjs`, `bin/diff-build.mjs`, post-build audits via [`tests/audits/lib.mjs`](../tests/audits/lib.mjs) |

Changing `site-config.mjs` + `brand.mjs` propagates the structural identity. `site.ts`
carries the human copy (bio, skills, nav, social) — edit it directly.

## 2. Residue — change by hand per instance

### Repo / package
- [`package.json`](../package.json) — `name`.
- [`README.md`](../README.md) — the five CI badge URLs (`github.com/<owner>/<repo>`).
- [`SECURITY.md`](../SECURITY.md) — contact and disclosure details.

### Edge runtime (Cloudflare Pages Functions — deliberately not imported)
- [`functions/_middleware.ts`](../functions/_middleware.ts) — `CSP_REPORT_ENDPOINT`.
- [`functions/api/csp-report.ts`](../functions/api/csp-report.ts) — `SITE_ORIGIN`.

These stay literal: importing `src/lib` into the edge bundle is an untested
deploy coupling. Keep them in sync with `site-config.mjs` `domain` manually.

### Signed / generated artifacts
- [`public/.well-known/security.txt`](../public/.well-known/security.txt) — all URLs,
  then re-sign with `npm run sign:security` using the instance's `security@` key.
- `public/.well-known/openpgpkey/hu/*` — the WKD key file (regenerate from the key).
- Brand assets in `public/assets/brand/`, favicons in `public/assets/icons/`, and the
  OG card `public/assets/og/og-default.png` — regenerate with `npm run make:icons`,
  `make:og`, `make:social` after editing `brand.mjs`.
- OG/social card copy (eyebrow, tagline, meta) in
  [`bin/make-og-image.mjs`](../bin/make-og-image.mjs) and
  [`bin/make-github-social.mjs`](../bin/make-github-social.mjs).

### CI / external config
- [`.lighthouserc.json`](../.lighthouserc.json) — audited URLs.
- [`.github/workflows/link-check.yml`](../.github/workflows/link-check.yml) — `--base-url`.

### Cloudflare dashboard (not in the repo)
- Pages project, the `DB` D1 binding pointing at the `d1` database from `site-config.mjs`,
  Turnstile keys, and any environment variables. The repo has no `wrangler.toml`
  by design; bindings live in the dashboard.
- Apply the D1 schema: `wrangler d1 execute <d1> --remote --file=./db/schema.sql`.

### Content
- Replace `src/content/pages/` and `src/content/writeups/` (synced from the vault),
  and the matching `public/assets/pages/` and `public/assets/writeups/`.
- `src/content/technology-groups.md` — the tag taxonomy (vault-synced).
