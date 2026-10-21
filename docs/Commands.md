# Command Reference

Every command in the repository is a mise task. `mise tasks` lists them with
their descriptions, `mise run <task>` runs one, and arguments after the task
name go to its script unchanged: `mise run site validate`,
`mise run cloudflare plan --json`. The detail that doesn't fit one line comes
first; the [full list](#every-task) at the end is generated from each task's
`description` in `mise.toml` by
`mise generate task-docs --inject --output docs/Commands.md`, and the
`checks:docs-sync` gate refuses a stale copy. The one npm script left is
`npm run build`, the build command Cloudflare Pages runs with only Node and
npm.

## Gates

`mise install` installs the pinned toolchain (`mise.toml`, checksums in
`mise.lock`), then the npm packages from the lockfile (`mise run deps`, which
skips itself while `node_modules` matches the lockfile). A gate is a task
named `<job>:<gate>`: `checks:*` before a build, `built:*` against the build
in `dist/`, `browser:*` in a browser. Each aggregate runs its job collect-all
and names every gate that failed; a failing gate prints its own fix. CI runs
the same tasks, one aggregate per job.

Arguments after a browser task go to Playwright:
`mise run browser:e2e --ui` opens the interactive runner, and
`mise run browser:visual --update-snapshots` re-baselines the visual
snapshots after an intentional design change (review every PNG in the diff
and commit them with the change).

**`mise run check`**: what CI's `build` job runs. Every `checks:*` gate
collect-all, then the production build, then every `built:*` gate
collect-all. The `built:*` gates run only after a build that succeeded, never
against a stale `dist/`. It validates the current checkout and never syncs the
vault; run `mise run sync:content` first to refresh editorial inputs.
`mise run fast` runs only the `checks:*` gates (well under a minute).

**`mise run browser`**: builds once with the Turnstile test key, then runs
the three browser suites one at a time against that build (`PREBUILT=1`), so
an 8 GB laptop never runs two browsers at once. Each suite run alone builds
what it serves. `mise run ci` is `check` and then `browser`: every gate the
pipeline runs.

**`mise run browser:edge`**: the edge runtime suite (`tests/edge/`). Serves
the output through `wrangler pages dev` with the compatibility date declared in
`tests/browser-test-env.ts`, and asserts what only Cloudflare's runtime
produces: the hash CSP covering every inline script and style, one identical
policy on every request, the `/contact/` Trusted Types exemption, the `public/_headers` security and cache rules, a real 404,
the contact function's refusals (no Turnstile token, wrong content type,
malformed JSON, fields outside the contract), byte-exact `security.txt`, and the
WKD key's content type. CI's `edge` leg runs it. **`mise run serve:edge`**
starts the same runtime on `http://127.0.0.1:8788` for by-hand checks.

## Daily, in detail

**`mise run dev`**: the Astro dev server on
`localhost:4321`. `site dev --drafts` syncs the vault,
drafts included, into the gitignored `.cache/drafts` overlay and points the
dev server at it with `SITE_CONTENT_ROOT`; the committed snapshot is left alone.

**`mise run sync:content`**: copies published writeups and pages from the
Obsidian vault into `src/content/` and their assets into `public/assets/`.
The synced snapshot is committed, so the public repo never depends on the
private vault. Never edit the synced files by hand; the next sync overwrites
them. Caches live under the gitignored `.cache/`. See [`Vault-Workflow.md`](./Vault-Workflow.md).

**`mise run sync:tokens`**: serializes the lockfile-pinned `severino-brand`
web contract into committed build inputs: the `:root` block in
`src/styles/tokens.css` plus identity, surface, card, and theme-role exports in
`src/lib/brand.ts`. The package derives those semantic mappings once from its
canonical `tokens.json`; this repository only declares output targets. The
embedded SHA-256 digest records the exact upstream token source. Like
`sync:content`, deployment consumes the committed projection and stays
self-contained. `mise run sync:tokens --check` (run by
`mise run checks:contracts`) fails CI on drift. See
[`Brand-System.md`](./Brand-System.md).

**`mise run sync:edge-site`**: writes `functions/generated/site.ts`, the edge
runtime's copy of the site identity in `src/lib/site-config.ts` (domain,
origin, CSP report endpoint). Cloudflare bundles `functions/` on its own, so
the Functions and the report receiver cannot import `src/lib`; they import
the projection instead. `mise run checks:contracts` fails when it is stale.

**`mise run diff:build`**: builds the committed HEAD in a temporary worktree
and the current working tree side by side, then reports any difference in the
shipped output, to show whether a refactor changes the artifact.

## Release, in detail

**`mise run lighthouse`**: Lighthouse against the live site, using the
lockfile's Lighthouse (the generation PageSpeed Insights scores with) and the
URLs, device preset, and thresholds declared in `tests/lighthouse.json`. Prints a
score line per page, writes the table to the job summary in CI, and exits
non-zero on an audit execution failure or an `error`-level threshold. Uses the
lockfile's Playwright Chromium (`npx playwright install chromium`), with
`CHROME_PATH` available for an explicit browser override. CI installs Chromium
and its system dependencies before the audit. Per-page logs accompany the
reports, including when Chrome fails to launch. Expect best practices in the
70s from any client Cloudflare distrusts: Bot Fight Mode's injected detection
script uses deprecated browser APIs (Bot Fight Mode must stay off for the zone,
since a hash CSP cannot cover it), and PageSpeed Insights is not served that
script.

**`mise run deploy:verify`**: run after a production deploy, from a residential IP;
Cloudflare Bot Fight Mode challenges GitHub-hosted runners, so CI does not run
it. Confirms the local HEAD matches origin, waits for every required check
(build, e2e, visual, edge, Cloudflare Pages) to pass,
then probes the live site: security headers on `/` and a deep writeup page
picked from the live sitemap, every sitemap URL returns 200, the preview proxy
is absent in production, the live home page's inline script and stylesheet are covered by the
CSP's hashes (`inline`), an unknown route returns a real 404, `POST
/api/contact` without a Turnstile token is refused, the contact form carries a
Turnstile site key, the live `security.txt`
matches the committed file, and zero open CodeQL alerts. Every check
runs even after an earlier one fails. `--origin <url>` verifies one
Cloudflare Pages deployment instead (what `deploy.yml` runs), `--preview`
marks a branch preview, and `--slug <writeup>` checks one writeup.

**`mise run build`**: the production build alone (`bin/build-static.ts`):
`astro build`, the sitedrift wrap, then the CSP hashes. Cloudflare Pages runs
the same file as `npm run build`, with only Node and npm, so it needs nothing
mise installs; `npm run build -- --timings` profiles the Astro build.

## Occasional, in detail

**`mise run make:icons` / `make:og` / `make:social`**: regenerate the brand
assets (favicons + marks, the Open Graph card, the GitHub social preview)
from the brand engine. Generated output is committed, so these only run when
the brand changes. See [`Brand-System.md`](./Brand-System.md).

**`mise run make:font`**: re-subsets the one webfont,
`public/assets/fonts/inter/inter-variable-latin.woff2`, to the characters the
content uses and the 400 to 700 weight range the stylesheet declares, keeping
Inter's optical-size axis. The character list and range live in
[`mise-tasks/make/font`](../mise-tasks/make/font); widen them there, then rerun
with `--source <InterVariable.woff2>` from an upstream Inter release (the
committed file is already a subset, so it can only shrink further).
`--output <path>` writes the result elsewhere to compare it first. The
fontTools CLIs run through `uvx`, which `mise install` provides.

**`mise run make:content-index`**: emits `public/content-index.json` from the
validated, published writeup snapshot. The static build invokes it
automatically. The generated file is gitignored: the build is the one place
that writes it, and consumers read the deployed JSON.

**`mise run scaffold:writeup-field`**: adds a field only to
`contracts/content.v1.json`, the canonical writeup contract. Dry-run by
default. After `--apply`, run `mise run sync:contract`; the typed Astro schema,
MCP projection, CLI/tool schemas, and the `site manage` TUI derive from that one contract.

**`mise run draft:cover-alt`**: drafts `cover_alt` text for one writeup, or
with `--all` every published writeup missing it, via the Claude API, for
human review before it lands in the vault.

**`mise run sign:security`**: clear-signs `public/.well-known/security.txt`
with the security@ key. The signature, fields, and expiry are verified by
`mise run checks:security-txt` on every gate run, so an expired or tampered
file cannot ship. See [`SECURITY.md`](../SECURITY.md).

**`mise run seo:preview`**: renders a Google-style result snippet and the
full metadata readout for a built page (`--result <slug>` for just the
snippet). Reads the built HTML, so run a build first.

**`mise run preview`**: serves the most recent build locally, the same way
the Playwright suite consumes it.

**`mise run clean:generated`**: removes build output (`dist/`), `.astro/`, and
the Vite cache. Synced content is left alone; `sync:content` owns it.

**`mise run cloudflare`** and **`mise run github`**: each takes `check`,
`plan`, or `apply`, as in `mise run cloudflare plan`; `apply` prints the plan
and makes the calls only with `--yes`. See [`Cloudflare.md`](./Cloudflare.md)
and [`GitHub-Settings.md`](./GitHub-Settings.md).

## Beyond the tasks

Renovate proposes every dependency update and opens a fix as soon as GitHub
reports an advisory ([`Dependencies.md`](./Dependencies.md)); `npm outdated`
reports direct dependency freshness locally. The publishing workflow
(`mise run site <command>`: validate, publish, land, featured, and the
`site manage` TUI) is documented in [`Site-CLI.md`](./Site-CLI.md).

## Every task

<!-- mise-tasks -->
## `browser`

- **Usage:** `browser`

Every browser gate, one at a time: one build with the test site key, then each suite

## `browser:e2e`

- **Usage:** `browser:e2e`

The functional Playwright specs pass across Chromium, Firefox, and WebKit

## `browser:edge`

- **Usage:** `browser:edge`

Served through `wrangler pages dev`: the CSP and its inline-tag hashes, the _headers rules, the contact page exemption, a real 404, the contact refusals, and security.txt parity

## `browser:visual`

- **Usage:** `browser:visual`

Screenshots of the fixture build match the committed macOS Chromium baselines

## `build`

- **Usage:** `build`

The production build: astro build, the sitedrift wrap, the CSP hashes

## `built`

- **Usage:** `built`

CI job build, last phase: every gate on the build in dist/, collect-all

## `built:assets`

- **Usage:** `built:assets`

No image the build ships (committed or encoded from content) exceeds 1.5 MB

## `built:html`

- **Usage:** `built:html`

html-validate: no built page repeats an id, every &lt;img> has alt, headings open at one h1 and never skip a level; and no literal `::name` directive reaches the page text

## `built:links`

- **Usage:** `built:links`

Every internal link, src, and srcset in the build, its #fragment included, resolves to an emitted file or a Function route

## `built:routes`

- **Usage:** `built:routes`

Only the Function routes invoke Functions, and the built _headers has no placeholder left, lists each path once, and carries the policy on /* and its own on /contact/*

## `built:seo`

- **Usage:** `built:seo`

Every built page has a title, canonical link, og:title, og:image, and only valid JSON-LD

## `built:weight`

- **Usage:** `built:weight`

Per-page HTML (150 KB), CSS (75 KB), and total JS (25 KB) stay within budget

## `check`

- **Usage:** `check`

Does my change work: every static gate, the production build, then every gate on what it built (CI job build)

## `checks`

- **Usage:** `checks`
- **Aliases:** `fast`

CI job build, first phase: every static gate, collect-all

## `checks:actionlint`

- **Usage:** `checks:actionlint`

jactionlint finds no syntax, expression, action-input or shellcheck error in the workflows or actions

## `checks:astro`

- **Usage:** `checks:astro`

`astro check` reports no errors or warnings in the .astro files, content schemas, or imports

## `checks:contracts`

- **Usage:** `checks:contracts`

Each generated projection (brand tokens, contact OpenAPI, content schemas, embed CSS, edge site identity) matches what its script derives from the canonical source

## `checks:contrast`

- **Usage:** `checks:contrast`

Every registered text/background color pairing in the tokens meets WCAG AA (4.5:1)

## `checks:css-lint`

- **Usage:** `checks:css-lint`

Stylelint passes over src/styles

## `checks:css-vars`

- **Usage:** `checks:css-vars`

Every CSS custom property defined in src/styles is referenced somewhere in src/

## `checks:doc-links`

- **Usage:** `checks:doc-links`

Every relative link, image, and #anchor (GitHub heading slugs) in the engineering docs resolves

## `checks:docs`

- **Usage:** `checks:docs`

Every `mise run` task and backticked repo path in the engineering docs resolves, and no doc runs an npm script other than `npm run build`

## `checks:docs-sync`

- **Usage:** `checks:docs-sync`

The task list in docs/Commands.md matches these tasks (fix: `mise generate task-docs --inject --output docs/Commands.md`, then commit it)

## `checks:drafts`

- **Usage:** `checks:drafts`

No document under src/content is `published: false`

## `checks:duplication`

- **Usage:** `checks:duplication`

No run of 30+ identical tokens over 3+ lines appears twice in the tracked TypeScript (40/4 between two test files)

## `checks:functions`

- **Usage:** `checks:functions`

The contact contract projects exactly to the API Shield schema, the handler consumes the contract, and every INSERT names only columns cloudflare/d1.sql defines

## `checks:parity`

- **Usage:** `checks:parity`

The Astro writeup schema, the public projection, the writeup store, and the `site manage` TUI all read their fields from the content contract

## `checks:patch`

- **Usage:** `checks:patch`

No whitespace errors or conflict markers in the working tree

## `checks:preview`

- **Usage:** `checks:preview`

The sitedrift review wrapper is present on preview branches and absent on main

## `checks:repo-policy`

- **Usage:** `checks:repo-policy`

Node and npm pins agree; no secrets or build output tracked; component styles live in src/styles; TypeScript only, no explicit any or unexplained suppressions; runners fixed, every job time-boxed

## `checks:security-txt`

- **Usage:** `checks:security-txt`

security.txt is clear-signed with a valid signature, carries the RFC 9116 fields, expires at least 60 days out, and its Encryption URL names a committed WKD key

## `checks:types`

- **Usage:** `checks:types`

Every TypeScript file compiles under one strict program, and functions/ again under the Workers lib

## `checks:unit`

- **Usage:** `checks:unit`

The node:test specs under tests/unit pass

## `checks:workflows`

- **Usage:** `checks:workflows`

zizmor finds no security issue in the workflows or actions (pinned uses, permissions, injection, triggers), apart from the findings .github/zizmor.yml accepts with a reason

## `ci`

- **Usage:** `ci`

Every gate the pipeline runs: check, then the browser suites

## `clean:generated`

- **Usage:** `clean:generated`

Remove build output and build caches

## `cloudflare`

- **Usage:** `cloudflare`

`check` diffs the live zone and account against `cloudflare/zone.json` (read token; exit 1 on drift), `plan` lists the API calls an apply would make, `apply --yes` makes them (edit token; owned rules only)

## `deploy:verify`

- **Usage:** `deploy:verify`

After the merge deploys, from a residential IP: verify remote CI and the live production deploy

## `deps`

- **Usage:** `deps`

Install the npm packages from package-lock.json; skipped while node_modules matches the lockfile

## `dev`

- **Usage:** `dev`

Start the local dev server

## `diff:build`

- **Usage:** `diff:build`

Build HEAD and the working tree; show what changed in the shipped site

## `diff:content`

- **Usage:** `diff:content`

What a content change means by slug: published, edited, removed, pages, generated (`--json`)

## `draft:cover-alt`

- **Usage:** `draft:cover-alt`

Draft writeup cover alt text through the Claude API

## `github`

- **Usage:** `github`

`check` diffs the live repository settings, security features, Actions permissions, and `main` ruleset against `.github/repo.json` (exit 1 on drift), `plan` lists the API calls an apply would make, `apply --yes` makes them (admin token)

## `lighthouse`

- **Usage:** `lighthouse`

Lighthouse against the live site with the URLs and thresholds in `tests/lighthouse.json` (needs Chrome; CI runs it weekly)

## `make:content-index`

- **Usage:** `make:content-index`

Emit the published-writeup JSON projection consumed by Severino HQ

## `make:embed`

- **Usage:** `make:embed`

Regenerate `public/embed/bundle.css`, the embeddable stylesheet (brand vars, base.css, inlined Inter)

## `make:font`

Re-subset the Inter webfont to the site's characters, weights 400-700 and the optical-size axis, from the committed file or an upstream Inter release


- **Usage:** `make:font [--source <font>] [--output <font>]`

### Flags
- **`--source <font>`** — Inter variable font to start from (default: the committed font)
- **`--output <font>`** — Where to write the result (default: the committed font)

## `make:icons`

- **Usage:** `make:icons`

Regenerate favicons and brand marks

## `make:og`

- **Usage:** `make:og`

Regenerate the Open Graph card

## `make:social`

- **Usage:** `make:social`

Regenerate the GitHub social preview

## `preview`

- **Usage:** `preview`

Serve the built site locally

## `publish:dist`

- **Usage:** `publish:dist`

Commit a build directory to the `dist` branch (CI publishes it on every push to `main`)

## `scaffold:writeup-field`

- **Usage:** `scaffold:writeup-field`

Add a field once to the canonical writeup contract

## `seo:preview`

- **Usage:** `seo:preview`

Preview a page's Google snippet and metadata from built HTML

## `serve:edge`

- **Usage:** `serve:edge`

Serve the build through `wrangler pages dev` for by-hand checks (headers and functions active)

## `sign:security`

- **Usage:** `sign:security`

Re-sign `public/.well-known/security.txt`

## `site`

- **Usage:** `site`

The publishing workflow CLI: `mise run site <command>` (validate, publish, land, featured, manage, …)

## `snapshot:github`

- **Usage:** `snapshot:github`

Refresh the committed GitHub repo snapshot, the only source the portfolio Software list reads for repos

## `snapshot:software`

- **Usage:** `snapshot:software`

Refresh the committed PyPI/npm snapshot (versions, monthly downloads); fails without writing if any lookup fails

## `sync:contact-openapi`

- **Usage:** `sync:contact-openapi`

Regenerate contact OpenAPI from its request contract

## `sync:content`

- **Usage:** `sync:content`

Pull published content from the vault into the repo

## `sync:contract`

- **Usage:** `sync:contract`

Regenerate typed content-contract projections

## `sync:edge-site`

- **Usage:** `sync:edge-site`

Regenerate the edge runtime's copy of the site identity (`functions/generated/site.ts`)

## `sync:tokens`

- **Usage:** `sync:tokens`

Pull design and brand tokens from `severino-brand` into the repo
<!-- /mise-tasks -->
