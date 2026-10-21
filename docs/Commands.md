# Command Reference

Every command in the repository: the gates are mise tasks, the tools are npm
scripts grouped by role. First the two overviews, then the detail that doesn't
fit one line. Both overviews are rendered by `npm run sync:docs`, the scripts
from the same table `npm run help` prints and the gates from `mise tasks`, and
the `checks:docs-sync` gate refuses a stale copy.

## Gates

`mise install` installs the pinned toolchain (`mise.toml`, checksums in
`mise.lock`). A gate is a task named `<job>:<gate>`: `checks:*` before a build,
`built:*` against the build in `dist/`, `browser:*` in a browser. Each
aggregate runs its job collect-all and names every gate that failed; a failing
gate prints its own fix. CI runs the same tasks, one aggregate per job.

<!-- generated:start task-overview (npm run sync:docs) -->

| Task | Asserts or does |
| :--- | :--- |
| `mise run browser` | Every browser gate, one at a time: one build with the test site key, then each suite |
| `mise run browser:e2e` | The functional Playwright specs pass across Chromium, Firefox, and WebKit |
| `mise run browser:edge` | Served through `wrangler pages dev`: the CSP and its inline-tag hashes, the _headers rules, the contact page exemption, a real 404, the contact refusals, and security.txt parity |
| `mise run browser:visual` | Screenshots of the fixture build match the committed macOS Chromium baselines |
| `mise run build` | The production build: astro build, the sitedrift wrap, the CSP hashes |
| `mise run built` | CI job build, last phase: every gate on the build in dist/, collect-all |
| `mise run built:assets` | No image the build ships (committed or encoded from content) exceeds 1.5 MB |
| `mise run built:html` | html-validate: no built page repeats an id, every <img> has alt, headings open at one h1 and never skip a level; and no literal `::name` directive reaches the page text |
| `mise run built:links` | Every internal link, src, and srcset in the build, its #fragment included, resolves to an emitted file or a Function route |
| `mise run built:routes` | Only the Function routes invoke Functions, and the built _headers has no placeholder left, lists each path once, and carries the policy on /* and its own on /contact/* |
| `mise run built:seo` | Every built page has a title, canonical link, og:title, og:image, and only valid JSON-LD |
| `mise run built:weight` | Per-page HTML (150 KB), CSS (75 KB), and total JS (25 KB) stay within budget |
| `mise run check` | Does my change work: every static gate, the production build, then every gate on what it built (CI job build) |
| `mise run checks` (also `mise run fast`) | CI job build, first phase: every static gate, collect-all |
| `mise run checks:astro` | `astro check` reports no errors or warnings in the .astro files, content schemas, or imports |
| `mise run checks:contracts` | Each generated projection (brand tokens, contact OpenAPI, content schemas, embed CSS, edge site identity) matches what its script derives from the canonical source |
| `mise run checks:contrast` | Every registered text/background color pairing in the tokens meets WCAG AA (4.5:1) |
| `mise run checks:css-lint` | Stylelint passes over src/styles |
| `mise run checks:css-vars` | Every CSS custom property defined in src/styles is referenced somewhere in src/ |
| `mise run checks:doc-links` | Every relative link, image, and #anchor (GitHub heading slugs) in the engineering docs resolves |
| `mise run checks:docs` | Every `npm run` script, `mise run` task, and backticked repo path in the engineering docs resolves |
| `mise run checks:docs-sync` | The generated blocks in docs/Commands.md match bin/help.ts and these tasks |
| `mise run checks:drafts` | No document under src/content is `published: false` |
| `mise run checks:duplication` | No run of 30+ identical tokens over 3+ lines appears twice in the tracked TypeScript (40/4 between two test files) |
| `mise run checks:functions` | The contact contract projects exactly to the API Shield schema, the handler consumes the contract, and every INSERT names only columns cloudflare/d1.sql defines |
| `mise run checks:parity` | The Astro writeup schema, the public projection, the writeup store, and the `site manage` TUI all read their fields from the content contract |
| `mise run checks:patch` | No whitespace errors or conflict markers in the working tree |
| `mise run checks:preview` | The sitedrift review wrapper is present on preview branches and absent on main |
| `mise run checks:repo-policy` | Node and npm pins agree; no secrets or build output tracked; component styles live in src/styles; TypeScript only, no explicit any or unexplained suppressions; runners fixed, every job time-boxed |
| `mise run checks:security-txt` | security.txt is clear-signed with a valid signature, carries the RFC 9116 fields, expires at least 60 days out, and its Encryption URL names a committed WKD key |
| `mise run checks:types` | Every TypeScript file compiles under one strict program, and functions/ again under the Workers lib |
| `mise run checks:unit` | The node:test specs under tests/unit pass |
| `mise run checks:workflows` | zizmor finds no security issue in the workflows or actions (pinned uses, permissions, injection, triggers), apart from the findings .github/zizmor.yml accepts with a reason |
| `mise run ci` | Every gate the pipeline runs: check, then the browser suites |

<!-- generated:end task-overview -->

Arguments after a browser task go to Playwright:
`mise run browser:e2e --ui` opens the interactive runner, and
`mise run browser:visual --update-snapshots` re-baselines the visual
snapshots after an intentional design change (review every PNG in the diff
and commit them with the change).

## npm scripts

<!-- generated:start command-overview (npm run sync:docs) -->

### Daily

| Command | Does |
| :--- | :--- |
| `npm run dev` | Start the local dev server |
| `npm run site` | The publishing workflow CLI: `npm run site -- <command>` (validate, publish, land, featured, …) |
| `npm run sync:content` | Pull published content from the vault into the repo |
| `npm run sync:contract` | Regenerate typed content-contract projections |
| `npm run sync:contact-openapi` | Regenerate contact OpenAPI from its request contract |
| `npm run sync:tokens` | Pull design + brand tokens from `severino-brand` into the repo |
| `npm run sync:edge-site` | Regenerate the edge runtime's copy of the site identity (`functions/generated/site.ts`) |
| `npm run sync:docs` | Regenerate the generated blocks in `docs/Commands.md` (these scripts and the mise tasks) |
| `npm run diff:build` | Build HEAD vs the working tree; show what changed in the shipped site |
| `npm run help` | Print this list grouped by role; `mise tasks` lists the gates |

### Release

| Command | Does |
| :--- | :--- |
| `npm run deploy:verify` | After the merge deploys, from a residential IP: verify remote CI + the live production deploy |
| `npm run diff:content` | What a content change means by slug: published, edited, removed, pages, generated (`-- --json`) |
| `npm run build` | The production build: astro build, the sitedrift wrap, the CSP hashes (Cloudflare Pages' build command) |

### Occasional

| Command | Does |
| :--- | :--- |
| `npm run make:icons` | Regenerate favicons + brand marks |
| `npm run make:og` | Regenerate the Open Graph card |
| `npm run make:embed` | Regenerate `public/embed/bundle.css`, the embeddable stylesheet (brand vars + base.css + inlined Inter) |
| `npm run make:content-index` | Emit the published-writeup JSON projection consumed by Severino HQ |
| `npm run make:social` | Regenerate the GitHub social preview |
| `npm run make:font` | Re-subset the Inter webfont to the site's characters and weights (needs python3 + fontTools) |
| `npm run snapshot:github` | Refresh the committed GitHub repo snapshot, the only source the portfolio Software list reads for repos |
| `npm run snapshot:software` | Refresh the committed PyPI/npm snapshot (versions, monthly downloads); fails without writing if any lookup fails |
| `npm run scaffold:writeup-field` | Add a field once to the canonical writeup contract |
| `npm run draft:cover-alt` | Draft writeup cover alt text via the Claude API |
| `npm run sign:security` | Re-sign `public/.well-known/security.txt` |
| `npm run preview:seo` | Preview a page's Google snippet + metadata from built HTML |
| `npm run preview` | Serve the built site locally |
| `npm run serve:edge` | Serve the build through `wrangler pages dev` for by-hand checks (headers + functions active) |
| `npm run cloudflare:check` | Diff the live zone and account against `cloudflare/zone.json` (read token; exit 1 on drift) |
| `npm run cloudflare:plan` | The Cloudflare API calls an apply would make |
| `npm run cloudflare:apply` | Plan, or with `-- --yes` apply `cloudflare/zone.json` (edit token; owned rules only) |
| `npm run publish:dist` | Commit a build directory to the `dist` branch (CI publishes it on every push to `main`) |
| `npm run github:check` | Diff the live repository settings, security features, Actions permissions, and `main` ruleset against `.github/repo.json` (exit 1 on drift) |
| `npm run github:plan` | The GitHub API calls an apply would make |
| `npm run github:apply` | Plan, or with `-- --yes` apply `.github/repo.json` (admin token) |
| `npm run check:lighthouse` | Lighthouse against the live site with the URLs and thresholds in `tests/lighthouse.json` (needs Chrome; CI runs it weekly) |
| `npm run clean:generated` | Remove build output and build caches |

<!-- generated:end command-overview -->

---

## Daily, in detail

**`npm run dev`**: the Astro dev server on
`localhost:4321`. `site dev --drafts` syncs the vault,
drafts included, into the gitignored `.cache/drafts` overlay and points the
dev server at it with `SITE_CONTENT_ROOT`; the committed snapshot is left alone.

**`npm run sync:content`**: copies published writeups and pages from the
Obsidian vault into `src/content/` and their assets into `public/assets/`.
The synced snapshot is committed, so the public repo never depends on the
private vault. Never edit the synced files by hand; the next sync overwrites
them. Caches live under the gitignored `.cache/`. See [`Vault-Workflow.md`](./Vault-Workflow.md).

**`npm run sync:tokens`**: serializes the lockfile-pinned `severino-brand`
web contract into committed build inputs: the `:root` block in
`src/styles/tokens.css` plus identity, surface, card, and theme-role exports in
`src/lib/brand.ts`. The package derives those semantic mappings once from its
canonical `tokens.json`; this repository only declares output targets. The
embedded SHA-256 digest records the exact upstream token source. Like
`sync:content`, deployment consumes the committed projection and stays
self-contained. `npm run sync:tokens -- --check` (run by
`mise run checks:contracts`) fails CI on drift. See
[`Brand-System.md`](./Brand-System.md).

**`npm run sync:edge-site`**: writes `functions/generated/site.ts`, the edge
runtime's copy of the site identity in `src/lib/site-config.ts` (domain,
origin, CSP report endpoint). Cloudflare bundles `functions/` on its own, so
the Functions and the report receiver cannot import `src/lib`; they import
the projection instead. `mise run checks:contracts` fails when it is stale.

**`npm run sync:docs`**: rewrites the generated blocks between
`<!-- generated:start … -->` markers: the overview tables above, the scripts
from the groups in `bin/help.ts` and the gates from each task's
`description` in `mise.toml`. `mise run checks:docs-sync` runs it with
`--check`, so a description is written once, beside the code it describes.

**`npm run diff:build`**: builds the committed HEAD in a temporary worktree
and the current working tree side by side, then reports any difference in the
shipped output, to show whether a refactor changes the artifact.

## Gates, in detail

**`mise run check`**: what CI's `build` job runs. Every `checks:*` gate
collect-all, then the production build, then every `built:*` gate
collect-all. The `built:*` gates run only after a build that succeeded, never
against a stale `dist/`. It validates the current checkout and never syncs the
vault; run `npm run sync:content` first to refresh editorial inputs.
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
WKD key's content type. CI's `edge` leg runs it. **`npm run serve:edge`**
starts the same runtime on `http://127.0.0.1:8788` for by-hand checks.

## Release, in detail

**`npm run check:lighthouse`**: Lighthouse against the live site, using the
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

**`npm run deploy:verify`**: run after a production deploy, from a residential IP;
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

**`npm run build`**: the production build alone (`bin/build-static.ts`):
`astro build`, the sitedrift wrap, then the CSP hashes; `-- --timings`
profiles the Astro build. Cloudflare Pages runs it with only Node and npm, so
it needs nothing mise installs. `mise run build` runs the same file.

## Occasional, in detail

**`npm run make:icons` / `make:og` / `make:social`**: regenerate the brand
assets (favicons + marks, the Open Graph card, the GitHub social preview)
from the brand engine. Generated output is committed, so these only run when
the brand changes. See [`Brand-System.md`](./Brand-System.md).

**`npm run make:font`**: re-subsets the one webfont,
`public/assets/fonts/inter/inter-variable-latin.woff2`, to the characters the
content uses and the 400 to 700 weight range the stylesheet declares, keeping
Inter's optical-size axis. The character list and range live in
[`bin/make-font.ts`](../bin/make-font.ts); widen them there, then rerun with
`--source <InterVariable.woff2>` from an upstream Inter release (the committed
file is already a subset, so it can only shrink further). Needs `python3` with
`fontTools` and `brotli`.

**`npm run make:content-index`**: emits `public/content-index.json` from the
validated, published writeup snapshot. The static build invokes it
automatically. The generated file is gitignored: the build is the one place
that writes it, and consumers read the deployed JSON.

**`npm run scaffold:writeup-field`**: adds a field only to
`contracts/content.v1.json`, the canonical writeup contract. Dry-run by
default. After `--apply`, run `npm run sync:contract`; the typed Astro schema,
MCP projection, CLI/tool schemas, and the `site manage` TUI derive from that one contract.

**`npm run draft:cover-alt`**: drafts `cover_alt` text for one writeup, or
with `--all` every published writeup missing it, via the Claude API, for
human review before it lands in the vault.

**`npm run sign:security`**: clear-signs `public/.well-known/security.txt`
with the security@ key. The signature, fields, and expiry are verified by
`mise run checks:security-txt` on every gate run, so an expired or tampered
file cannot ship. See [`SECURITY.md`](../SECURITY.md).

**`npm run preview:seo`**: renders a Google-style result snippet and the
full metadata readout for a built page (`-- --result <slug>` for just the
snippet). Reads the built HTML, so run a build first.

**`npm run preview`**: serves the most recent build locally, the same way
the Playwright suite consumes it.

**`npm run clean:generated`**: removes build output (`dist/`), `.astro/`, and
the Vite cache. Synced content is left alone; `sync:content` owns it.

## Beyond npm

Renovate proposes every dependency update and opens a fix as soon as GitHub
reports an advisory ([`Dependencies.md`](./Dependencies.md)); `npm outdated`
reports direct dependency freshness locally. The publishing workflow (`npm run site -- <command>`: validate,
publish, land, featured, and the `site manage` TUI) is documented in
[`Site-CLI.md`](./Site-CLI.md).
