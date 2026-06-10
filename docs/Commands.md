# Command Reference

Every npm script in the repository, grouped by role — first as a scannable
overview, then with the detail that doesn't fit a one-liner. `npm run help`
prints the live version of the overview straight from `package.json`, so it
can never go stale; this document adds the depth. A unit test asserts every
script in `package.json` appears here, so the reference cannot silently fall
behind the scripts.

## Overview

### Daily — the ones you actually run

| Command | Does |
| :--- | :--- |
| `npm run dev` | Start the local dev server |
| `npm run dev:drafts` | Dev server including unpublished drafts |
| `npm run sync:content` | Pull published content from the vault into the repo |
| `npm run diagnose` | Run every check and report what is wrong — the "is it okay?" button |
| `npm run diff:build` | Build HEAD vs the working tree; show what changed in the shipped site |

### Release

| Command | Does |
| :--- | :--- |
| `npm run publish:check` | Fast local build gate (`-- --no-sync` for code-only changes) |
| `npm run publish:check:ci` | The same gate under CI conditions: `CI=1` + a scratch keyring |
| `npm run release:check` | Full gate: publish:check + browser/visual/policy + idempotence (macOS) |
| `npm run deploy:verify` | After pushing: verify remote CI + the live production deploy |
| `npm run build` | Type-check, then produce the static build (what CI's `build` job wraps) |

### Occasional — run when the specific need comes up

| Command | Does |
| :--- | :--- |
| `npm run make:icons` | Regenerate favicons + brand marks |
| `npm run make:og` | Regenerate the Open Graph card |
| `npm run make:social` | Regenerate the GitHub social preview |
| `npm run scaffold:primer` | Scaffold a new reference primer in the vault |
| `npm run scaffold:writeup-field` | Add a writeup frontmatter field across every layer |
| `npm run draft:cover-alt` | Draft writeup cover alt text via the Claude API |
| `npm run sign:security` | Re-sign `public/.well-known/security.txt` |
| `npm run seo:preview` | Preview a page's Google snippet + metadata from built HTML |
| `npm run preview` | Serve the built site locally |
| `npm run test:unit` | Unit suite: markdown DSL, Cloudflare functions, gate harness, registry |
| `npm run test:e2e` | Playwright functional specs across Chromium, Firefox, WebKit |
| `npm run test:e2e:ui` | Playwright in interactive UI mode |
| `npm run test:e2e:visual` | Visual-regression snapshots (macOS Chromium) |
| `npm run test:e2e:visual:update` | Re-baseline visual snapshots after an intentional design change |
| `npm run clean:generated` | Remove build output + caches, then resolve conflict copies |
| `npm run clean:conflicts` | Resolve iCloud conflict copies only |

### Internal — run by the commands above; rarely typed directly

| Command | Does |
| :--- | :--- |
| `npm run check` | CSS lint + unused-var audit + `astro check` (used by `build`) |
| `npm run build:static` | `astro build` + sitedrift wrap (used by `build` and the gates) |
| `npm run lint:css` | Stylelint over `src/styles/` |
| `npm run check:security` | security.txt signature, required fields, expiry, WKD file |
| `npm run check:contrast` | WCAG ratios for every text/background pair in `base.css` |
| `npm run check:parity` | Vault schema, Zod config, and MCP server agree on writeup fields |
| `npm run check:types` | Strict TypeScript over `functions/` |
| `npm run check:edge` | Contact handler, OpenAPI schema, and D1 schema agree |
| `npm run check:preview` | Sitedrift wrapping on previews, absent on main |
| `npm run check:docs` | Every doc link and `npm run` reference resolves |
| `npm run check:css` | No CSS custom property is defined but never used |
| `npm run check:links` | Every internal reference in the built site resolves |
| `npm run check:weight` | Per-page HTML and total CSS/JS stay inside their byte budgets |
| `npm run check:html` | No duplicate ids; every image carries alt |
| `npm run check:seo` | Title, canonical, og:title, og:image, valid JSON-LD on every page |
| `npm run check:repo` | Node pin, lockfile alignment, clean tree, SHA-pinned Actions |
| `npm run audit:assets` | Image count + weight report (the gates run it strict) |
| `npm run help` | Print the live grouped list of all of the above |

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

**`npm run deploy:verify`** — run after pushing `main`. Confirms the local
HEAD matches origin, audits production dependencies, polls the GitHub API
until every required check (build, e2e, visual, CodeQL, Cloudflare Pages) is
green, then probes the live site: security headers on `/` and a deep writeup
page picked from the live sitemap, every sitemap URL returns 200, the preview
proxy is absent in production, and zero open code-scanning alerts.

**`npm run build`** — `check` + `build:static`; the plain compile pipeline
without the audit gates. CI's `build` job runs the full `publish:check`
instead, which includes everything this does.

## Occasional, in detail

**`npm run make:icons` / `make:og` / `make:social`** — regenerate the brand
assets (favicons + marks, the Open Graph card, the GitHub social preview)
from the brand engine. Generated output is committed, so these only run when
the brand changes. See [`Brand-System.md`](./Brand-System.md).

**`npm run scaffold:primer`** — scaffolds a new reference primer in the
vault's `04 Reference/` with the slim frontmatter the MCP expects.

**`npm run scaffold:writeup-field`** — adds a new writeup frontmatter field
across every layer that must agree on it (vault schema, Zod config, MCP
server). Dry-run by default; the parity audit holds the layers together
afterward.

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
day-to-day use, but the npm scripts above are the canonical repo-local
interface.
