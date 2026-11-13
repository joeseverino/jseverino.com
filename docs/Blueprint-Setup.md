# Blueprint setup

Every value a new site built from this codebase changes. Most live in a few
sources the rest of the code imports; the residue is static text in files that
cannot `import` (deploy manifests, signed files, dashboards), changed by hand.

## Sources the code imports

| File | Holds | Consumers |
| --- | --- | --- |
| [`src/lib/site-config.ts`](../src/lib/site-config.ts) | `domain`, `owner`, `github`, `worker`, `focus`, and `PREVIEW_HOST_SUFFIX` (the Worker's preview hosts on the account's workers.dev subdomain) | Site chrome and feeds, GitHub loading and snapshots, `astro.config.ts`, `bin/*`, audits, the Worker's CSP and report endpoint |
| Lockfile-pinned `severino-brand` contract | Brand tokens and glyph geometry | `sync:tokens` emits [`src/lib/brand.ts`](../src/lib/brand.ts), [`src/styles/brand.css`](../src/styles/brand.css), and the generated block in [`tokens.css`](../src/styles/tokens.css) |
| [`src/lib/site.ts`](../src/lib/site.ts) | editorial chrome: `jobTitle`, `summary`, `skills`, `socialLinks`, `navItems` | `Header`, `Footer`, `SeoHead` |
| [`src/lib/build-output.ts`](../src/lib/build-output.ts) | the build outDir decision (write side) and built-dir resolution (read side) | `astro.config.ts`, `bin/build-static.ts`, `bin/seo-preview.ts`, `bin/diff-build.ts`, post-build audits via [`tests/audits/lib.ts`](../tests/audits/lib.ts) |

Changing `site-config.ts` propagates structural identity; nothing is generated from it. Change brand tokens upstream and run
`mise run sync:tokens`; generated projections are never edited directly. `site.ts`
carries the human copy (bio, skills, nav, social).

## Residue: changed by hand

### Repo / package
- [`package.json`](../package.json): `name`.
- [`README.md`](../README.md): the two badge URLs (`github.com/<owner>/<repo>`).
- [`SECURITY.md`](../.github/SECURITY.md): contact and disclosure details.

### Edge runtime
The Worker's routes (contact form and CSP reporting) and its middleware import
`site-config.ts` directly, so the domain is declared once.
[`wrangler.jsonc`](../wrangler.jsonc) names the Worker (`name`) and the D1
database (`database_name`), and cannot import. For a new instance, set `name`
to `SITE.worker`, since the preview deploy refuses any other Worker name, and
`database_name` to the new database, which `site contact` and `site csp` read
from there.

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
- [`mise.toml`](../mise.toml): the `links:content` task's `--base-url`.
- [`.github/repo.json`](../.github/repo.json): the public `PUBLIC_TURNSTILE_SITE_KEY` the build embeds, and the repository settings.

### Cloudflare zone and account
- [`cloudflare/zone.json`](../cloudflare/zone.json): the zone name, the owner tag on
  rules, the production hosts in the WAF expressions, and the Turnstile hostnames.
  Check and apply
  with `mise run cloudflare check` / `apply` ([docs/Cloudflare.md](./Cloudflare.md)).

### Cloudflare dashboard (not in the repo)
- The D1 database `wrangler.jsonc` names and its schema, the
  Turnstile widget and its two keys, the deploy credentials, the Worker's first
  deploy with its secret, the custom domain, and the preview Access application:
  [Standing up the Worker](./Cloudflare.md#standing-up-the-worker).

### Content
- Replace `src/content/pages/` and `src/content/writeups/` (synced from the vault,
  each document with its images beside it).
- `src/content/technology-groups.md`: the tag taxonomy (vault-synced).
