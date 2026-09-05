# Command Reference

Every npm script in the repository, grouped by role — first as a scannable
overview, then with the detail that doesn't fit a one-liner. The overview is
rendered by `npm run sync:docs` from the same table `npm run help` prints, and
the gate refuses a stale copy; a unit test asserts every script in
`package.json` appears here, so the reference cannot silently fall behind the
scripts. This document adds the depth.

## Overview

<!-- generated:start command-overview (npm run sync:docs) -->

### Daily — the everyday workflow

| Command | Does |
| :--- | :--- |
| `npm run dev` | Start the local dev server |
| `npm run dev:drafts` | Dev server including unpublished drafts |
| `npm run sync:content` | Pull published content from the vault into the repo |
| `npm run sync:contract` | Regenerate typed content-contract projections |
| `npm run sync:contact-openapi` | Regenerate contact OpenAPI from its request contract |
| `npm run sync:tokens` | Pull design + brand tokens from `severino-brand` into the repo |
| `npm run sync:edge-site` | Regenerate the edge runtime's copy of the site identity (`functions/generated/site.ts`) |
| `npm run sync:docs` | Regenerate the generated blocks in `docs/Commands.md` and `tests/ARCHITECTURE.md` |
| `npm run diagnose` | Run every check and report what is wrong — the "is it okay?" button |
| `npm run diff:build` | Build HEAD vs the working tree; show what changed in the shipped site |

### Release

| Command | Does |
| :--- | :--- |
| `npm run publish:check` | Fast local build gate (`-- --no-sync` for code-only changes) |
| `npm run publish:check:ci` | The same gate under CI conditions: `CI=1` + a scratch keyring |
| `npm run release:check` | Full gate: publish:check + browser/visual/policy + idempotence (macOS) |
| `npm run gate:check` | CI's first job: the registry's fast pre-build audits, collect-all, before build, e2e, and visual start |
| `npm run deploy:verify` | After pushing, from a residential IP: verify remote CI + the live production deploy |
| `npm run build` | Type-check, then produce the static build (what CI's `build` job wraps) |

### Occasional — run when the specific need comes up

| Command | Does |
| :--- | :--- |
| `npm run make:icons` | Regenerate favicons + brand marks |
| `npm run make:og` | Regenerate the Open Graph card |
| `npm run make:embed` | Regenerate `public/embed/bundle.css` — the one embeddable stylesheet (brand vars + base.css + inlined Inter) |
| `npm run make:content-index` | Emit the published-writeup JSON projection consumed by Severino HQ |
| `npm run make:social` | Regenerate the GitHub social preview |
| `npm run make:font` | Re-subset the Inter webfont to the site's characters and weights (needs python3 + fontTools) |
| `npm run snapshot:github` | Refresh the committed GitHub repo snapshot the portfolio Software list falls back to |
| `npm run scaffold:primer` | Scaffold a new reference primer in the vault |
| `npm run scaffold:writeup-field` | Add a field once to the canonical writeup contract |
| `npm run draft:cover-alt` | Draft writeup cover alt text via the Claude API |
| `npm run sign:security` | Re-sign `public/.well-known/security.txt` |
| `npm run seo:preview` | Preview a page's Google snippet + metadata from built HTML |
| `npm run preview` | Serve the built site locally |
| `npm run test:unit` | Unit suite: markdown DSL, Cloudflare functions, gate harness, registry |
| `npm run test:e2e` | Playwright functional specs across Chromium, Firefox, WebKit |
| `npm run test:e2e:ui` | Playwright in interactive UI mode |
| `npm run test:e2e:visual` | Visual-regression snapshots (macOS Chromium) |
| `npm run test:e2e:visual:update` | Re-baseline visual snapshots after an intentional design change |
| `npm run test:edge` | Serve the build through the Cloudflare runtime and assert headers, CSP nonces, cache rules, and the functions |
| `npm run edge:serve` | Serve the build through `wrangler pages dev` for by-hand checks (middleware + functions active) |
| `npm run check:lighthouse` | Lighthouse against the live site with the URLs and thresholds in `.lighthouserc.json` (needs Chrome; CI runs it weekly) |
| `npm run clean:generated` | Remove build output + caches, then resolve conflict copies |
| `npm run clean:conflicts` | Resolve iCloud conflict copies only |

### Internal — run by the commands above; rarely typed directly

| Command | Does |
| :--- | :--- |
| `npm run check` | CSS lint + unused-var audit + `astro check` (used by `build`) |
| `npm run build:static` | `astro build` + sitedrift wrap (used by `build` and the gates) |
| `npm run lint:css` | Stylelint over `src/styles/` |
| `npm run check:security` | security.txt signature, required fields, expiry, WKD file |
| `npm run check:tokens` | Committed brand projections match the lockfile-pinned upstream contract |
| `npm run check:contrast` | WCAG ratios for every text/background pair in `base.css` |
| `npm run check:parity` | Vault schema, Zod config, MCP server, and the `site manage` TUI agree on writeup fields |
| `npm run check:types` | Strict TypeScript over `functions/` |
| `npm run check:edge` | Contact handler, OpenAPI schema, and D1 schema agree |
| `npm run check:preview` | Sitedrift wrapping on previews, absent on main |
| `npm run check:docs` | Every doc link and `npm run` reference resolves |
| `npm run check:css-vars` | No CSS custom property is defined but never used |
| `npm run check:links` | Every internal reference in the built site resolves |
| `npm run check:weight` | Per-page HTML and total CSS/JS stay inside their byte budgets |
| `npm run check:html` | No duplicate ids; every image carries alt |
| `npm run check:embed` | `public/embed/bundle.css` matches its sources (regenerate with `make:embed`) |
| `npm run check:seo` | Title, canonical, og:title, og:image, valid JSON-LD on every page |
| `npm run check:repo-policy` | Node pin, lockfile alignment, clean tree, SHA-pinned Actions |
| `npm run audit:assets` | Image count + weight report (the gates run it strict) |
| `npm run help` | Print the live grouped list of all of the above |

<!-- generated:end command-overview -->

What each audit asserts, and how to fix it when it fails, is documented
check-by-check in [`tests/ARCHITECTURE.md`](../tests/ARCHITECTURE.md).

---

## Daily, in detail

**`npm run dev` / `npm run dev:drafts`** — the Astro dev server on
`localhost:4321`. The `:drafts` variant first syncs unpublished vault drafts
into the content snapshot so they render locally; a later plain
`sync:content` (or any gate) removes them again.

**`npm run sync:content`** — copies published writeups and pages from the
Obsidian vault into `src/content/` and their assets into `public/assets/`.
The synced snapshot is committed, so the public repo never depends on the
private vault. Never edit the synced files by hand — the next sync wipes
them. See [`Vault-Workflow.md`](./Vault-Workflow.md).

**`npm run sync:tokens`** — serializes the lockfile-pinned `severino-brand`
web contract into committed build inputs: the `:root` block in
`src/styles/tokens.css` plus identity, surface, card, and theme-role exports in
`src/lib/brand.mjs`. The package derives those semantic mappings once from its
canonical `tokens.json`; this repository only declares output targets. The
embedded SHA-256 digest records the exact upstream token source. Like
`sync:content`, deployment consumes the committed projection and stays
self-contained. `npm run check:tokens` fails CI on drift. See
[`Brand-System.md`](./Brand-System.md).

**`npm run sync:edge-site`** — writes `functions/generated/site.ts`, the edge
runtime's copy of the site identity in `src/lib/site-config.mjs` (domain,
origin, CSP report endpoint). Cloudflare bundles `functions/` on its own, so
the middleware and the report receiver cannot import `src/lib`; they import
the projection instead. `check:contracts` (inside every gate) fails when it is
stale.

**`npm run sync:docs`** — rewrites the generated blocks between
`<!-- generated:start … -->` markers: the overview tables above, from the
groups in `bin/help.mjs`, and the gate-coverage table in
[`tests/ARCHITECTURE.md`](../tests/ARCHITECTURE.md), from the audit registry.
The `docs-sync` audit runs it with `--check` inside every gate, so a
description or a gate assignment is written once, in code, and the docs
follow.

**`npm run diagnose`** — the one-stop gate. Runs every check in the registry
without stopping at the first failure: green prints one line; red writes
`.validation-report.md` with one row per failure, a remediation, and the exact
command to rerun that single check (long output is clipped — the rerun command
is the path to the full thing).

- `-- --fast` — only the static checks (~7s); skips build and browser tests.
- `-- --no-tests` — static checks + build; skips the browser suite.
- `-- --json` — a single machine-readable document (per-check status,
  durations, rerun + fix per failure) instead of console output. The contract
  for agents and CI.

**`npm run diff:build`** — builds the committed HEAD in a temporary worktree
and the current working tree side by side, then reports any difference in the
shipped output. Answers "does this refactor change the artifact?" with bytes,
not vibes.

## Release, in detail

**`npm run publish:check`** — the fast local build gate: clean, sync,
every `publish`-gated audit from
[`tests/audits/registry.mjs`](../tests/audits/registry.mjs), the production
build, and the post-build audits. Fail-fast: stops at the first broken check.
`-- --no-sync` skips the vault sync so a code-only change can be verified
without dragging in unrelated content drift.

**`npm run publish:check:ci`** — rehearses exactly what CI's `build` job runs:
`CI=1` (so local-only audits skip, same as on the runner) and a scratch GPG
keyring seeded only from the committed WKD key. If the gate secretly depends
on authoring-machine state, it fails here instead of after a push.

**`npm run release:check`** — the final local gate before pushing: runs
`publish:check`, then the release-only audits (repository policy,
`git diff --check`, the full cross-browser + visual Playwright suite), and
fails if any of it mutated the worktree. Requires macOS because the committed
visual baselines are macOS Chromium renders.

**`npm run gate:check`** — the `gate` job in `ci.yml`. Runs the registry
audits that claim the `gate` gate (source integrity, repository policy, docs
link integrity, stylesheet lint) and keeps going after a failure so one report
names every broken invariant. Cheap on purpose: it finishes in under a minute
so an unpinned action or a misaligned lockfile fails before `build`, `e2e`,
and `visual` install anything. In CI the results land in the job summary.

**`npm run test:edge`** — the edge runtime suite (`tests/edge/`). Builds, serves
the output through `wrangler pages dev` with the compatibility date declared in
`tests/browser-test-env.mjs`, and asserts what only Cloudflare's runtime
produces: the per-request CSP nonce stamped on every script tag and rotating
between requests, the `public/_headers` security and cache rules, a real 404,
the contact function's refusals (no Turnstile token, wrong content type,
malformed JSON, fields outside the contract), byte-exact `security.txt`, and the
WKD key's content type. CI's `edge` leg and the local `release:check` and
`diagnose` gates run it. **`npm run edge:serve`** starts the same runtime on
`http://127.0.0.1:8788` for by-hand checks.

**`npm run check:lighthouse`** — Lighthouse against the live site, using the
lockfile's Lighthouse (the generation PageSpeed Insights scores with) and the
URLs, device preset, and thresholds declared in `.lighthouserc.json`. Prints a
score line per page, writes the table to the job summary in CI, and exits
non-zero only on an `error`-level threshold. Needs Chrome. Expect best
practices in the 70s from any client Cloudflare distrusts: Bot Fight Mode's
injected detection script uses deprecated browser APIs, and PageSpeed Insights
is not served that script.

**`npm run deploy:verify`** — run after pushing `main`, from a residential IP;
Cloudflare Bot Fight Mode challenges GitHub-hosted runners, so CI does not run
it. Confirms the local HEAD matches origin, audits production dependencies,
polls the GitHub API until every required check (build, e2e, visual, edge,
CodeQL, Cloudflare Pages) is green,
then probes the live site: security headers on `/` and a deep writeup page
picked from the live sitemap, every sitemap URL returns 200, the preview proxy
is absent in production, the CSP nonce is stamped on every script tag and
rotates between requests, an unknown route returns a real 404, `POST
/api/contact` without a Turnstile token is refused, the live `security.txt`
matches the committed file, and zero open code-scanning alerts. Every check
runs even after an earlier one fails.

**`npm run build`** — `check` + `build:static`; the plain compile pipeline
without the audit gates. CI's `build` job runs the full `publish:check`
instead, which includes everything this does.

## Occasional, in detail

**`npm run make:icons` / `make:og` / `make:social`** — regenerate the brand
assets (favicons + marks, the Open Graph card, the GitHub social preview)
from the brand engine. Generated output is committed, so these only run when
the brand changes. See [`Brand-System.md`](./Brand-System.md).

**`npm run make:font`** — re-subsets the one webfont,
`public/assets/fonts/inter/inter-variable-latin.woff2`, to the characters the
content uses and the 400–700 weight range the stylesheet declares, keeping
Inter's optical-size axis. The character list and range live in
[`bin/make-font.mjs`](../bin/make-font.mjs); widen them there, then rerun with
`--source <InterVariable.woff2>` from an upstream Inter release (the committed
file is already a subset, so it can only shrink further). Needs `python3` with
`fontTools` and `brotli`.

**`npm run make:content-index`** — emits `public/content-index.json` from the
validated, published writeup snapshot. The static build invokes it
automatically. The generated file is deliberately uncommitted: the site build
is the single projection boundary, and Severino HQ consumes the deployed JSON
without re-reading vault or repository internals.

**`npm run scaffold:primer`** — scaffolds a new reference primer in the
vault's `04 Reference/` with the slim frontmatter the MCP expects.

**`npm run scaffold:writeup-field`** — adds a field only to
`contracts/content.v1.json`, the canonical writeup contract. Dry-run by
default. After `--apply`, run `npm run sync:contract`; the typed Astro schema,
MCP projection, CLI/tool schemas, and Tools TUI derive from that one contract.

**`npm run draft:cover-alt`** — drafts `cover_alt` text for one or every
writeup via the Claude API, for human review before it lands in the vault.

**`npm run sign:security`** — clear-signs `public/.well-known/security.txt`
with the security@ key. The signature, fields, and expiry are verified by
`check:security` on every gate run, so an expired or tampered file cannot
ship. See [`SECURITY.md`](../SECURITY.md).

**`npm run seo:preview`** — renders a Google-style result snippet and the
full metadata readout for a built page (`-- --result <slug>` for just the
snippet). Reads the built HTML, so run a build first.

**`npm run preview`** — serves the most recent build locally, the same way
the Playwright suite consumes it.

**`npm run test:unit` / `test:e2e` / `test:e2e:ui` / `test:e2e:visual` /
`test:e2e:visual:update`** — the test layers individually; the gates run them
via the registry. The visual `:update` variant re-baselines snapshots after
an intentional design change — regenerate, eyeball the diff, commit the PNGs
with the change.

**`npm run clean:generated` / `clean:conflicts`** — both call
`bin/clean-generated.mjs` with an explicit mode (the script refuses to run
without one): `--all` removes build output and caches then resolves iCloud
conflict copies; `--conflicts` only resolves the conflict copies.

## Beyond npm

`npm audit --omit=dev` checks production dependency advisories (also enforced
post-push by `deploy:verify`), and `npm outdated` reports direct dependency
freshness. The personal `site` CLI wraps the publishing commands for
day-to-day use — including `site manage`, a full-screen TUI over the writeup
and operations surface — but the npm scripts above are the canonical
repo-local interface. The CLI and the TUI are documented in
[`Site-CLI.md`](./Site-CLI.md).
