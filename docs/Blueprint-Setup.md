# Blueprint Setup

This repo is the reference implementation behind a future site blueprint. This
file lists every *instance-specific* value: what a new site built from this
codebase must change. Two kinds exist:

1. **Importable**: single sources the rest of the code derives from. Edit the
   source and every consumer follows.
2. **Residue**: static text in files that cannot `import` (deploy manifests,
   signed files, external dashboards). Change these by hand.

## 1. Importable single sources

| File | Holds | Consumers |
| --- | --- | --- |
| [`src/lib/site-config.ts`](../src/lib/site-config.ts) | `domain`, `owner`, `github`, `d1`, `worker`, `focus`, and `PREVIEW_HOST_SUFFIX` (the Worker's preview hosts on the account's workers.dev subdomain) | Site chrome and feeds, GitHub loading and snapshots, `astro.config.ts`, `bin/*`, audits, the Worker's CSP and report endpoint |
| Lockfile-pinned `severino-brand` contract | Brand tokens and glyph geometry | `sync:tokens` emits [`src/lib/brand.ts`](../src/lib/brand.ts), [`src/styles/brand.css`](../src/styles/brand.css), and the generated block in [`tokens.css`](../src/styles/tokens.css) |
| [`src/lib/site.ts`](../src/lib/site.ts) | editorial chrome: `jobTitle`, `summary`, `skills`, `socialLinks`, `navItems` | `Header`, `Footer`, `SeoHead` |
| [`src/lib/build-output.ts`](../src/lib/build-output.ts) | the build outDir decision (write side) and built-dir resolution (read side) | `astro.config.ts`, `bin/build-static.ts`, `bin/seo-preview.ts`, `bin/diff-build.ts`, post-build audits via [`tests/audits/lib.ts`](../tests/audits/lib.ts) |

Changing `site-config.ts` propagates structural identity; nothing is generated from it. Change brand tokens upstream and run
`mise run sync:tokens`; generated projections are never edited directly. `site.ts`
carries the human copy (bio, skills, nav, social).

### CSS and interaction contract

[`base.css`](../src/styles/base.css) is the only stylesheet entry point. Each
focused module is imported once into the declared `tokens`, `base`, and
`components` layers. Extend a shared component rule before adding a variant;
variants own only their differences. Keep design values in named tokens and
logical properties, with the site-local font choice next to its font asset.

Cards share one `.card-surface` element and one
hover rule. Animate the inner surface while the outer list item retains a
stable pointer target. Preserve keyboard focus, reduced motion, forced colors,
and touch behavior when adding interactions. Prefer native controls and bundled
component scripts; reserve inline execution for first-paint initialization.

After CSS changes, regenerate `public/embed/bundle.css` with `mise run make:embed`.
The diagnostic gate verifies that generated output matches its source, along
with contrast, page weight, responsive layouts, and interaction regressions.

## 2. Residue: change by hand per instance

### Repo / package
- [`package.json`](../package.json): `name`.
- [`README.md`](../README.md): the two badge URLs (`github.com/<owner>/<repo>`).
- [`SECURITY.md`](../.github/SECURITY.md): contact and disclosure details.

### Edge runtime
The Worker's routes (contact form and CSP reporting) and its middleware import
`site-config.ts` directly, so the domain is declared once.
[`wrangler.jsonc`](../wrangler.jsonc) names the Worker (`name`) and the D1
database (`database_name`), and cannot import; change both for a new instance,
to the same values as `SITE.worker` and `SITE.d1`. The preview deploy refuses a
Worker name other than `SITE.worker`, and `mise run checks:d1` a database other
than `SITE.d1`.

### Signed / generated artifacts
- [`public/.well-known/security.txt`](../public/.well-known/security.txt): all URLs,
  then re-sign with `mise run sign:security` using the instance's `security@` key.
- `public/.well-known/openpgpkey/hu/*`: the WKD key file (regenerate from the key).
- Brand assets in `public/assets/brand/`, favicons in `public/assets/icons/`, and the
  OG card `public/assets/og/og-default.jpg`: regenerate with `mise run make:icons`,
  `make:og`, `make:social` after syncing the upstream brand contract.
- OG/social card copy (eyebrow, tagline, meta) in
  [`bin/make-og-image.ts`](../bin/make-og-image.ts) and
  [`bin/make-github-social.ts`](../bin/make-github-social.ts).

### CI / external config
- [`tests/lighthouse.json`](../tests/lighthouse.json): audited URLs.
- [`.github/workflows/link-check.yml`](../.github/workflows/link-check.yml): `--base-url`.
- [`.github/repo.json`](../.github/repo.json): the public `PUBLIC_TURNSTILE_SITE_KEY` the build embeds, and the repository settings.

### Cloudflare zone and account
- [`cloudflare/zone.json`](../cloudflare/zone.json): the zone name, the owner tag on
  rules, the production hosts in the WAF expressions, and the Turnstile hostnames.
  Check and apply
  with `mise run cloudflare check` / `apply` ([docs/Cloudflare.md](./Cloudflare.md)).

### Cloudflare dashboard (not in the repo)
- The D1 database named by `d1` in `site-config.ts` and its schema, the
  Turnstile widget and its two keys, the deploy credentials, the Worker's first
  deploy with its secret, the custom domain, and the preview Access application:
  [Standing up the Worker](./Cloudflare.md#standing-up-the-worker).

### Content
- Replace `src/content/pages/` and `src/content/writeups/` (synced from the vault,
  each document with its images beside it).
- `src/content/technology-groups.md`: the tag taxonomy (vault-synced).
