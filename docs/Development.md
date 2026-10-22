# Development

How the repository is built, checked, and shipped. Every script is in
[Commands](./Commands.md); the test suites are toured in
[`tests/README.md`](../tests/README.md).

## Setup

[mise](https://mise.jdx.dev) installs the toolchain: Node, pinned in
[`mise.toml`](../mise.toml) with its checksums in [`mise.lock`](../mise.lock),
and the same version in [`.nvmrc`](../.nvmrc), which Cloudflare Pages reads.
npm comes from `package.json`'s `packageManager`. `mise install` installs the
tools. The npm packages come from mise's `[deps.npm]` provider: before any
`mise run` or `mise exec`, it runs `npm ci` from the lockfile whenever
`package.json` or `package-lock.json` changed since the last install or
`node_modules` is missing, so a fresh checkout or a pull that moves the
lockfile is installed by the first task it runs (`mise deps install npm` runs
it on its own). CI installs packages per job in its setup action instead.
Machine paths for the content sync go in a gitignored
`mise.local.toml` ([Vault Workflow](./Vault-Workflow.md#local-workflow)). Copy
[`.env.example`](../.env.example) to `.env` for the Turnstile test keys, then:

```sh
mise install
mise doctor project                     # is this checkout ready to work in
mise run dev                            # Astro dev server
mise run build && mise run preview      # the build on the Workers runtime
```

`mise doctor project` runs the readiness checks `mise.toml` declares under
`[doctor.checks]`: the npm packages match the lockfile, `gh` is signed in,
the cache root exists, Playwright's browsers are installed, and no `mise.toml`
above the checkout is loaded. Each failure prints its fix. It never runs on
its own and is no gate: CI has no `gh` login, and the checks describe this
machine, not the change.

Every checkout and worktree shares one cache root, `SITE_CACHE_DIR` in
`mise.toml`'s `[env]` (under the platform cache directory): the content
sync's image masters, and Astro's encoded images in `astro/`.

## Code

Everything is TypeScript, run directly by Node 24, which strips the types: no
build step and no loader. Syntax Node cannot strip (enums, namespaces, parameter
properties) is out, so `erasableSyntaxOnly` is on and every relative import
names its `.ts` file. `mise run checks:types` is the one strict
check over the repo; `astro check` covers the `.astro` files. Shared logic lives
once, in `bin/lib/`, `src/lib/`, or a test helper, and the
gate fails on duplicated code.

## Gates

```sh
mise run fast             # the static gates: types, policy, docs, lint, duplication, unit tests, astro check
mise run check            # + the production build, then every gate on it (CI's build job)
mise run browser          # the browser suites, one at a time: e2e, visual, edge
mise run ci               # check, then browser: every gate the pipeline runs
mise run diff:build       # build HEAD and the working tree, report any change to shipped output
mise run deploy:verify    # after a merge: required checks, then the live deployment
```

Every gate is a mise task named `<job>:<gate>` (`mise tasks` lists them; the
[task list](./Commands.md#every-task) says what each asserts), and CI runs the same
tasks. The gates validate the current checkout without vault access; run
`mise run sync:content` explicitly before checking new editorial content. A
failing gate prints its own fix. Signature verification uses an isolated
keyring containing only the committed WKD public keys. Unit-test Git
repositories disable signing locally; production commit signing remains
configured by the author.

![Validation flow: local gates, the pull request with CI and preview verification, the merge, the production deploy and dist publish, and production verification](./diagrams/validation-flow.png)

<sup>Diagram source: [`docs/diagrams/validation-flow.mmd`](./diagrams/validation-flow.mmd),
pre-rendered with [`diagram`](https://github.com/joeseverino/tools/blob/main/bin/diagram).</sup>

## Test policy

New functionality ships with automated coverage in the same change, and a fix
for a reproducible defect ships with a regression test, at the layer that
matches what changed:

| Change | Layer |
| :--- | :--- |
| Pure library logic | [`tests/unit/`](../tests/unit/) |
| An invariant about the source tree | [`tests/audits/`](../tests/audits/) |
| Rendered or interactive behavior | [`tests/playwright/`](../tests/playwright/) |
| Headers, CSP, or the API routes as the Workers runtime serves them | [`tests/edge/`](../tests/edge/) |

A new audit is a task in `mise.toml`;
[`tests/ARCHITECTURE.md`](../tests/ARCHITECTURE.md#adding-a-new-audit) has the
steps.

## Continuous integration

| Workflow | Trigger | Does | Verified result |
| --- | --- | --- | --- |
| [`ci`](../.github/workflows/ci.yml) | push and pull request to `main` | Four independent jobs, no job waiting on another, so a failure always reports on its own required check. `build` runs `mise run check`: the static gates (workflow lint and audit included), then the gates on the same artifact `build-static` ships. The `playwright` matrix runs each `browser:*` task in its own leg: `e2e` (cross-browser, three workers), `visual` (macOS Chromium baselines of the synthetic content in `tests/fixtures/content`, so a publish never moves one), and `edge`, which serves the build through the Cloudflare runtime with `astro preview` and asserts what only that runtime produces: the hash CSP covering every inline script and style, one identical policy on every request, the `_headers` security and cache rules, a real 404, the contact handler's refusals, and byte-exact `security.txt`, all before anything deploys. The Linux legs install browser system packages while the site builds, then serve that build. | Green checks on the committed tree and a summary on every browser leg. |
| [`deploy`](../.github/workflows/deploy.yml) | Cloudflare Pages check-run completed; `ci` completed | `verify` runs the default branch's `deploy-verify --origin` against the deployment's own `*.pages.dev` URL (headers, inline-code hash coverage, cache rules, every sitemap route, 404, contact refusal, `security.txt`) with the Access service token and no branch code; `record` logs each verified deployment as a GitHub `production` or `preview` deployment; `report` keeps one pull-request comment current with the CI summaries and the deployment result, whichever finishes first. | One updating PR comment; a verification summary for every deployment. |
| [`dist`](../.github/workflows/deploy.yml) | push to `main` | Builds the site and commits the output to the `dist` branch ([Dist Branch](./Dist-Branch.md)); the only job with `contents: write`. | A `deploy: <sha>` commit on `dist`, or none when the output is unchanged. |
| [`dependency review`](../.github/workflows/dependency-review.yml) | pull request | Audits manifest package updates for high-severity advisories, passing at once when no manifest changed; comments only when it blocks. | Pull request status validation. |
| [`release`](../.github/workflows/release.yml) | `v*` tag | Builds the tagged commit (the tag is signed by convention; the trigger does not verify it), packages the build output and a CycloneDX SBOM, and attests both through Sigstore. | A GitHub release whose files verify with `gh attestation verify`. |
| [`scorecard`](../.github/workflows/scorecard.yml) | weekly, branch-protection change | OpenSSF Scorecard supply-chain posture, uploaded as SARIF to code scanning. | A code scanning alert per check with findings. |
| [`link check`](../.github/workflows/link-check.yml) | docs changes, weekly | Lychee audits repository documentation links and public content links separately (self-domain links excluded; 403/429/999 accepted as answered), writes both reports into the job summary, and uploads them. | Connectivity report artifacts. |
| [`lighthouse`](../.github/workflows/lighthouse.yml) | weekly | `bin/lighthouse-check.ts` runs the lockfile's Lighthouse (the same generation PageSpeed Insights scores with) against the live URLs in `tests/lighthouse.json`. | Fails below accessibility 95 or SEO 90; warns below performance 85 or best practices 70. Scores in the job summary, reports as artifacts. Best practices reads in the 70s from any client Cloudflare distrusts, because Bot Fight Mode's injected detection script uses deprecated browser APIs; PageSpeed Insights is not served that script and reports 100. |
| [`security.txt expires`](../.github/workflows/security-txt-expires.yml) | monthly | Runs `mise run checks:security-txt`, which fails from 60 days before `security.txt` expires. | A failed scheduled run, which GitHub emails. |

CodeQL runs as GitHub's default setup on pushes, pull requests and a weekly
schedule, declared in [`.github/repo.json`](../.github/repo.json) with the
`main` ruleset's code scanning rule, which holds a merge on a high-severity
alert ([GitHub Settings](./GitHub-Settings.md)).

Workflow hardening (pinned actions, job-scoped permissions, credential-free
checkouts) is in [Security](./Security.md#supply-chain-and-ci).

## Documentation

Docs change in the same commit as the code they describe. `mise run checks:doc-links`
(lychee, offline) fails when a relative link, anchor, or image points at
nothing, and `mise run checks:docs` when a `mise run` reference or a
backticked repo path does, or a doc runs an npm script other than the build. Both read only tracked files. The task list in
`docs/Commands.md` is generated:
`mise generate task-docs --inject --output docs/Commands.md`.
