# Command Reference

Every command in the repository is a mise task. `mise tasks` lists the entry
points and tools with their descriptions, `mise run <task>` runs one, and
arguments after the task name go to its script unchanged:
`mise run site validate`, `mise run cloudflare plan --json`. The detail that
doesn't fit one line comes first; the [full list](#every-task) at the end is
generated from each visible task's `description` in `mise.toml` and
`mise-tasks/` by `mise generate task-docs --inject --output docs/Commands.md`,
and the `checks:docs-sync` gate refuses a stale copy.

## Gates

`mise install` installs the pinned toolchain (`mise.toml`, checksums in
`mise.lock`). Every `mise run` first installs the npm packages from the
lockfile when `package.json` or `package-lock.json` changed (`[deps.npm]`;
the `--no-deps` flag skips it). A gate is a task
named `<job>:<gate>`: `checks:*` before a build, `built:*` against the build
in `dist/`, `browser:*` in a browser. Gates are hidden from `mise tasks` and
this list: `mise tasks --hidden` lists every one with what its pass
guarantees, and each is declared in its job's file under `mise-tasks/`
(`mise-tasks/checks.toml`) or as a script in its job's directory
(`mise-tasks/checks/`). Each aggregate runs its job collect-all
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

**`mise run browser:edge`**: the edge runtime suite (`tests/edge/`). It serves the output through `astro preview`, which runs the built Worker and its static assets in the local Cloudflare runtime under `wrangler.jsonc`. It asserts what only that runtime produces:

- The hash CSP covers every inline script and style, with one identical policy on every request.
- The `/contact/` Trusted Types exemption.
- The `public/_headers` security and cache rules.
- A real 404 and the trailing-slash redirect.
- The contact route's refusals (no Turnstile token, wrong content type, malformed JSON, fields outside the contract) and its security headers.
- A byte-exact `security.txt` and the WKD key's content type.

CI's `edge` leg runs it. **`mise run preview`** starts the same runtime for by-hand checks.

## Daily, in detail

**`mise run dev`**: the Astro dev server on
`localhost:4321`. `site dev --drafts` syncs the vault,
drafts included, into the gitignored `.cache/drafts` overlay and points the
dev server at it with `SITE_CONTENT_ROOT`; the committed snapshot is left alone.

**`mise run sync:content`**: copies published writeups and pages from the
Obsidian vault into `src/content/` and their assets into `public/assets/`.
The synced snapshot is committed, so the public repo never depends on the
private vault. Never edit the synced files by hand; the next sync overwrites
them. Its image masters are cached under the cache root every checkout
shares (`SITE_CACHE_DIR`). See [`Vault-Workflow.md`](./Vault-Workflow.md).

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

**`mise run diff:build`**: builds the committed HEAD in a temporary worktree
and the current working tree side by side, then reports any difference in the
shipped output, to show whether a refactor changes the artifact.

## Release, in detail

**`mise run lighthouse`**: Lighthouse against the live site, using the
lockfile's Lighthouse (the generation PageSpeed Insights scores with) and the
URLs, device preset, and thresholds declared in `tests/lighthouse.json`. Prints a
score line per page, writes the table to the job summary in CI, and exits
non-zero on an audit execution failure or an `error`-level threshold. Uses the
lockfile's Playwright Chromium (`mise exec -- playwright install chromium`),
with `CHROME_PATH` available for an explicit browser override. CI installs
Chromium and its system packages with `mise run setup:browsers chromium`
before the audit. Per-page logs accompany the reports,
including when Chrome fails to launch.

**`mise run deploy:verify`**: run after a production deploy, from a residential IP and a clean `main` checkout. It confirms the local HEAD matches origin and waits for every required check (build, e2e, visual, edge, deploy) to pass. Then it probes the live site:

- Security headers on `/` and on a deep writeup page picked from the live sitemap.
- Every sitemap URL returns 200.
- The preview proxy is absent in production.
- The live home page's inline script and stylesheet are covered by the CSP's hashes (`inline`).
- An unknown route returns a real 404.
- `POST /api/contact` without a Turnstile token is refused.
- The contact form carries a Turnstile site key.
- The live `security.txt` matches the committed file.
- No CodeQL alert is open.

Every check runs even after an earlier one fails. `--origin <url>` verifies one Worker version at its preview URL instead (what `deploy.yml` runs before a version takes traffic). `--preview` marks a branch preview, and `--slug <writeup>` checks one writeup.

**`mise run build`**: the build every deploy ships (`bin/build-static.ts`):
`astro build`, then the CSP hashes. CI builds once and the `deploy` workflow
ships that artifact, so production and a preview start from the same bytes;
a preview is wrapped afterwards by `mise run preview:wrap`.
`mise run build --timings` profiles the Astro build.

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
fontTools CLIs run through `uvx`, which mise installs from mise.lock on first use.

**`mise run make:content-index`**: emits `public/content-index.json` from the
validated, published writeup snapshot. The static build invokes it
automatically. The generated file is gitignored: the build is the one place
that writes it, and consumers read the deployed JSON.

**`mise run sync:contract`**: after adding a field as one line in
`contracts/content.v1.json`, the canonical writeup contract, regenerates what
derives from it: the typed Astro schema, MCP projection, CLI/tool schemas, and
the `site manage` TUI.

**`mise run site draft-alt <slug>|--all`**: drafts `cover_alt` text for one
writeup, or with `--all` for every published writeup missing one, via the
Claude API, for human review before it lands in the vault; `--apply` writes
each draft. See [`Site-CLI.md`](./Site-CLI.md).

**`mise run sign:security`**: clear-signs `public/.well-known/security.txt`
with the security@ key. The signature, fields, and expiry are verified by
`mise run checks:security-txt` on every gate run, so an expired or tampered
file cannot ship. See [`SECURITY.md`](../.github/SECURITY.md).

**`mise run site seo <page>`**: renders a Google-style result snippet and the
full metadata readout for a built page (`--result` for just the snippet).
Reads the built HTML, so run a build first.

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
reports an advisory ([`Dependencies.md`](./Dependencies.md)). The publishing workflow
(`mise run site <command>`: validate, publish, land, featured, and the
`site manage` TUI) is documented in [`Site-CLI.md`](./Site-CLI.md).

## Every task

<!-- mise-tasks -->
## `browser`

- **Usage:** `browser`

Every browser gate, one at a time: one build with the test site key, then each suite

## `build`

- **Usage:** `build`

The build every deploy ships: astro build, then the CSP hashes

## `build:browser`

- **Usage:** `build:browser`

The build the browser suites serve under PREBUILT: the deploy build, with the test site key

## `built`

- **Usage:** `built`

CI job build, last phase: every gate on the build in dist/client/, collect-all

## `check`

- **Usage:** `check`

Does my change work: every static gate, the production build, then every gate on what it built (CI job build)

## `checks`

- **Usage:** `checks`
- **Aliases:** `fast`

CI job build, first phase: every static gate, collect-all

## `ci`

- **Usage:** `ci`

Every gate the pipeline runs: check, then the browser suites

## `clean:generated`

- **Usage:** `clean:generated`

Remove build output (`dist/`), `.astro/` and the Vite cache; shared caches and synced content stay

## `cloudflare`

- **Usage:** `cloudflare`

`check` diffs the live zone and account against `cloudflare/zone.json` (read token; exit 1 on drift), `plan` lists the API calls an apply would make, `apply --yes` makes them (edit token; owned rules only)

## `d1:schema`

Apply `cloudflare/d1.sql` to the D1 database bound as `DB`: `local` (the one `mise run preview` serves) or `remote` (production)


- **Usage:** `d1:schema <database>`

### Arguments
- **`<database>`** — The local database or production

  **Choices:** `local`, `remote`

## `deploy:verify`

- **Usage:** `deploy:verify`

After the merge deploys, from a residential IP: verify remote CI and the live production deploy

## `dev`

- Depends: sync:worker-types

- **Usage:** `dev`

Start the local dev server

## `diff:build`

- **Usage:** `diff:build`

Build HEAD and the working tree; show what changed in the shipped site

## `fix:lint`

- **Usage:** `fix:lint`

Apply Biome's safe fixes and formatting to the files biome.jsonc covers, and report what it cannot fix

## `github`

- **Usage:** `github`

`check` diffs the live repository settings, security features, Actions permissions, and `main` ruleset against `.github/repo.json` (exit 1 on drift), `plan` lists the API calls an apply would make, `apply --yes` makes them (admin token)

## `lighthouse`

- **Usage:** `lighthouse`

Lighthouse against the live site with the URLs and thresholds in `tests/lighthouse.json` (needs Chrome; CI runs it weekly)

## `links:content`

- **Usage:** `links:content`

Every external link in the published content answers (online); links to jseverino.com itself are built:links' job

## `links:docs`

- **Usage:** `links:docs`

Every external link in the engineering docs answers (online)

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

Serve the build through the local Worker runtime: _headers, redirects, the 404 page and the API routes, as production serves them

## `preview:wrap`

- **Usage:** `preview:wrap`

Turn the finished build into a branch preview: add the review viewer, then rebuild the CSP to cover it

## `publish:dist`

- **Usage:** `publish:dist`

Commit a build directory to the `dist` branch (CI publishes it on every push to `main`)

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

## `sync:tokens`

- **Usage:** `sync:tokens`

Pull design and brand tokens from `severino-brand` into the repo

## `sync:worker-types`

- **Usage:** `sync:worker-types`

Write the Worker's `Env` and runtime types from wrangler.jsonc into src/generated/worker-configuration.d.ts
<!-- /mise-tasks -->
