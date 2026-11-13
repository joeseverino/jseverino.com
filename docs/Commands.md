# Command reference

Every command in the repository is a mise task. `mise tasks` lists the entry
points and tools with their descriptions, `mise run <task>` runs one, and
arguments after the task name go to its script unchanged:
`mise run site validate`, `mise run cloudflare plan --json`. The sections below
hold what doesn't fit one line; the [full list](#every-task) at the end is
generated from each visible task's `description` by
`mise generate task-docs --inject --output docs/Commands.md`, and the
`checks:docs-sync` gate refuses a stale copy.

## Build and check

A gate is a hidden task named `<job>:<gate>`; `mise tasks --hidden` lists each
with what its pass guarantees, and [Development](./Development.md#gates) has
the model. Every `mise run` first installs the npm packages when
`package.json` or `package-lock.json` changed (`--no-deps` skips it).

**`mise run check`**: what CI's `build` job runs. Every `checks:*` gate
collect-all, then the production build, then every `built:*` gate
collect-all, only after a build that succeeded. It validates the current
checkout and never syncs the vault. `mise run fast` runs only the `checks:*`
gates.

**`mise run browser`**: builds once with the Turnstile test key, then runs
the three browser suites one at a time against that build (`PREBUILT=1`).
Each suite run alone builds what it serves, and arguments after a browser task
go to Playwright: `mise run browser:e2e --ui` opens the interactive runner.
Updating the visual baselines follows
[the baseline rule](../AGENTS.md#visual-baselines). `mise run ci` is `check`
and then `browser`: every gate the pipeline runs.

**`mise run build`**: the build every deploy ships (`bin/build-static.ts`):
the writeup index (`public/content-index.json`, gitignored), `astro build`,
then the CSP hashes. CI builds once and the `deploy` workflow ships that
artifact, so production and a preview start from the same bytes; a preview is
wrapped afterwards by `mise run preview:wrap`. `mise run build --timings`
profiles the Astro build.

**`mise run preview`**: serves the most recent build through the local Worker
runtime, the way the Playwright suites consume it.

**`mise run diff:build`**: builds the committed HEAD in a temporary worktree
and the current working tree side by side, then reports any difference in the
shipped output, to show whether a refactor changes the artifact.

**`mise run clean:generated`**: the reset for a stale local build. It removes
`dist/`, `.astro/`, and the Vite cache; synced content and the shared cache
stay.

## Content

**`mise run dev`**: the Astro dev server on `localhost:4321`.
`site dev --drafts` syncs the vault, drafts included, into the gitignored
`.cache/drafts` overlay and points the dev server at it with
`SITE_CONTENT_ROOT`; the committed snapshot is left alone.

**`mise run sync:content`**: copies published writeups and pages from the
Obsidian vault into `src/content/` and their assets into `public/assets/`.
The synced snapshot is committed, so the public repo never depends on the
private vault. Never edit the synced files by hand; the next sync overwrites
them. Its image masters are cached under the cache root every checkout
shares (`SITE_CACHE_DIR`). See [`Vault-Workflow.md`](./Vault-Workflow.md).

**`mise run sync:contract`**: after adding a field as one line in
`contracts/content.v1.json`, the canonical writeup contract, regenerates what
derives from it: the typed Astro schema, MCP projection, CLI/tool schemas, and
the `site manage` TUI.

**`mise run site draft-alt <slug>|--all`**: drafts `cover_alt` text for one
writeup, or with `--all` for every published writeup missing one, via the
Claude API, for human review before it lands in the vault; `--apply` writes
each draft. See [`Site-CLI.md`](./Site-CLI.md).

**`mise run site seo <page>`**: renders a Google-style result snippet and the
metadata readout for a built page (`--result` for the snippet alone).
Reads the built HTML, so run a build first.

## Deploy

**`mise run deploy:verify`**: run after a production deploy, from a
residential IP and a clean `main` checkout. It confirms the local HEAD matches
origin and waits for the ruleset's required checks to pass. Then it probes the
live site:

- Security headers on `/` and on a deep writeup page picked from the live sitemap.
- Every sitemap URL returns 200.
- The preview proxy is absent in production.
- The live home page's inline script and stylesheet are covered by the CSP's hashes (`inline`).
- An unknown route returns a real 404.
- `POST /api/contact` without a Turnstile token is refused.
- The contact form carries a Turnstile site key.
- The live `security.txt` matches the committed file.
- No CodeQL alert is open.

Every check runs even after an earlier one fails. `--origin <url>` verifies one Worker version at its preview URL instead (what `preview.yml` and `deploy.yml` run before a version takes traffic). `--preview` marks a branch preview, and `--slug <writeup>` checks one writeup.

**`mise run lighthouse`**: Lighthouse against the live site, using the
lockfile's Lighthouse (the generation PageSpeed Insights scores with), auditing
each URL in `tests/lighthouse.json` on each form factor it lists against that
form factor's floor per category. Prints a score line per page and form
factor, writes the table to the job summary in CI, and exits non-zero on an
audit execution failure or any score below its floor. Uses the lockfile's
Playwright Chromium (`mise exec -- playwright install chromium`), with
`CHROME_PATH` available for an explicit browser override. CI installs Chromium
and its system packages with `mise run setup:browsers chromium` before the
audit. Per-page logs accompany the reports, including when Chrome fails to
launch.

**`mise run cloudflare`** and **`mise run github`**: each takes `check`,
`plan`, or `apply`, as in `mise run cloudflare plan`; `apply` prints the plan
and makes the calls only with `--yes`. See [`Cloudflare.md`](./Cloudflare.md)
and [`GitHub-Settings.md`](./GitHub-Settings.md).

**`mise run sign:security`**: clear-signs `public/.well-known/security.txt`
with the security@ key. The signature, fields, and expiry are verified by
`mise run checks:security-txt` on every gate run, so an expired or tampered
file cannot ship. See [`SECURITY.md`](../.github/SECURITY.md).

## Brand

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

**`mise run make:icons` / `make:og` / `make:social`**: regenerate the brand
assets (favicons and marks, the Open Graph card, the GitHub social preview)
from the brand engine. Generated output is committed, so these run only when
the brand changes.

**`mise run make:font`**: re-subsets the one webfont,
`src/assets/fonts/inter-variable-latin.woff2`, to the characters the
content uses and the weight range the stylesheet declares, keeping
Inter's optical-size axis. The character list and range live in
[`mise-tasks/make/font`](../mise-tasks/make/font); widen them there, then rerun
with `--source <InterVariable.woff2>` from an upstream Inter release (the
committed file is already a subset, so it can only shrink further).
`--output <path>` writes the result elsewhere to compare it first. The
fontTools CLIs run through `uvx`, which mise installs from mise.lock on first use.

## Beyond the tasks

Renovate proposes every dependency update and opens a fix as soon as GitHub
reports an advisory ([`Dependencies.md`](./Dependencies.md)). The publishing workflow
(`mise run site <command>`: validate, publish, land, featured, and the
`site manage` TUI) is documented in [`Site-CLI.md`](./Site-CLI.md).

## Every task

<!-- mise-tasks -->
## `browser`

- **Usage:** `browser`

Run every browser gate, one at a time: one build with the test site key, then each suite

## `build`

- **Usage:** `build`

Build what every deploy ships: the writeup index, astro build, then the CSP hashes

## `build:browser`

- **Usage:** `build:browser`

Build what the browser suites serve under PREBUILT: the deploy build, with the test site key

## `built`

- **Usage:** `built`

Run every gate on the build in dist/client/, collect-all (CI job build, last phase)

## `check`

- **Usage:** `check`

Check a change: every static gate, the production build, then every gate on what it built (CI job build)

## `checks`

- **Usage:** `checks`
- **Aliases:** `fast`

Run every static gate, collect-all (CI job build, first phase)

## `ci`

- **Usage:** `ci`

Run every gate the pipeline runs: check, then the browser suites

## `clean:generated`

- **Usage:** `clean:generated`

Remove build output (`dist/`), `.astro/` and the Vite cache; shared caches and synced content stay

## `cloudflare`

- **Usage:** `cloudflare`

Hold the live zone and account to `cloudflare/zone.json`: `check` diffs them (read token; exit 1 on drift), `plan` lists the API calls an apply would make, `apply --yes` makes them (edit token; owned rules only)

## `d1:schema`

Apply `cloudflare/d1.sql` to the D1 database bound as `DB`: `local` (the one `mise run preview` serves) or `remote` (production)


- **Usage:** `d1:schema <database>`

### Arguments
- **`<database>`** — The local database or production

  **Choices:** `local`, `remote`

## `deploy:verify`

- **Usage:** `deploy:verify`

Verify remote CI and the live production deploy, after the merge deploys, from a residential IP

## `dev`

- Depends: sync:worker-types

- **Usage:** `dev`

Start the local dev server

## `dev:look`

- **Usage:** `dev:look`

Screenshot pages of the build as `preview` serves it, at each width in light and dark, to see a layout change; exit 1 on a page that scrolls sideways or fails to load

## `diff:build`

- **Usage:** `diff:build`

Build HEAD and the working tree, and show what changed in the shipped site

## `fix:lint`

- **Usage:** `fix:lint`

Apply Biome's safe fixes and formatting to the files biome.jsonc covers, and report what it cannot fix

## `github`

- **Usage:** `github`

Hold the live repository settings, security features, Actions permissions, and `main` ruleset to `.github/repo.json`: `check` diffs them (exit 1 on drift), `plan` lists the API calls an apply would make, `apply --yes` makes them (admin token)

## `lighthouse`

- **Usage:** `lighthouse`

Run Lighthouse against the live site with the URLs and floors in `tests/lighthouse.json` (needs Chrome; CI runs it weekly)

## `links:content`

- **Usage:** `links:content`

Check that every external link in the published content answers (online); links to jseverino.com itself are built:links' job

## `links:docs`

- **Usage:** `links:docs`

Check that every external link in the engineering docs answers (online)

## `make:embed`

- **Usage:** `make:embed`

Regenerate `public/embed/bundle.css`, the embeddable stylesheet (brand vars, base.css, inlined Inter)

## `make:font`

Re-subset the Inter webfont to the site's characters, weights and optical-size axis, from the committed file or an upstream Inter release


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

Serve the build through the local Worker runtime: _headers, redirects, the 404 page and the API routes, as production serves them

## `preview:wrap`

- **Usage:** `preview:wrap`

Turn the finished build into a branch preview: add the review viewer, then rebuild the CSP to cover it

## `publish:dist`

- **Usage:** `publish:dist`

Commit a build directory to the `dist` branch, as the deploy workflow's `dist` job does; `--push` pushes it

## `setup:browsers`

Install the named Playwright browsers and their system packages


- **Usage:** `setup:browsers <browser>…`

### Arguments
- **`<browser>…`** — A browser to install

  **Choices:** `chromium`, `firefox`, `webkit`

## `sign:security`

- **Usage:** `sign:security`

Re-sign `public/.well-known/security.txt`

## `site`

- **Usage:** `site`

Run the publishing CLI: `mise run site <command>` (validate, publish, land, featured, manage, …)

## `snapshot:github`

- **Usage:** `snapshot:github`

Refresh the committed GitHub repo snapshot, the only source the portfolio Software list reads for repos

## `snapshot:software`

- **Usage:** `snapshot:software`

Refresh the committed PyPI/npm snapshot (versions, monthly downloads); fails without writing if any lookup fails

## `sync:contact-openapi`

- **Usage:** `sync:contact-openapi`

Regenerate the contact OpenAPI from its request contract

## `sync:content`

- **Usage:** `sync:content`

Pull published content from the vault into the repo

## `sync:contract`

- **Usage:** `sync:contract`

Regenerate the typed projections of the content contract

## `sync:tokens`

- **Usage:** `sync:tokens`

Pull design and brand tokens from `severino-brand` into the repo

## `sync:worker-types`

- **Usage:** `sync:worker-types`

Write the Worker's `Env` and runtime types from wrangler.jsonc into src/generated/worker-configuration.d.ts
<!-- /mise-tasks -->
