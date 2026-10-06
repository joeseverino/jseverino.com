# Development

How the repository is built, checked, and shipped. Every script is in
[Commands](./Commands.md); the test suites are toured in
[`tests/README.md`](../tests/README.md).

## Setup

Node comes from [`.nvmrc`](../.nvmrc) and npm from `package.json`'s
`packageManager`. Copy [`.env.example`](../.env.example) to `.env` for the
Turnstile test keys, then:

```sh
npm ci
npm run dev                # Astro dev server
npm run build:static && npm run edge:serve   # the build on the Cloudflare runtime
```

## Code

Everything is TypeScript, run directly by Node 24, which strips the types: no
build step and no loader. That rules out syntax Node cannot strip (enums,
namespaces, parameter properties), so `erasableSyntaxOnly` is on and every
relative import names its `.ts` file. `npm run typecheck` is the one strict
check over the repo; `astro check` covers the `.astro` files. Shared logic lives
once, in `bin/lib/`, `src/lib/`, `functions/lib/`, or a test helper, and the
gate fails on duplicated code.

## Gates

```sh
npm run gate:check         # fast invariants: types, policy, docs, lint, duplication
npm run publish:check      # + unit tests, astro check, the build, post-build audits, the edge suite
npm run diagnose           # every audit in one pass; writes .validation-report.md on failure
npm run diff:build         # build HEAD and the working tree, report any change to shipped output
npm run release:check      # publish:check, then the browser suites and an idempotence check
npm run deploy:verify      # after a merge: required checks, then the live deployment
```

Every gate reads its audits from
[`tests/audits/registry.ts`](../tests/audits/registry.ts). The browser suites
(e2e across Chromium, Firefox, and WebKit, and the visual baselines) run in CI;
`npm run publish:check:ci` rehearses the CI conditions locally.

![Validation flow from source change through the local gates, the pull request with CI and the preview verification, the merge, and production verification](./diagrams/validation-flow.png)

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
| Headers, CSP, or Functions as Cloudflare serves them | [`tests/edge/`](../tests/edge/) |

A new audit is registered in `tests/audits/registry.ts`;
[`tests/ARCHITECTURE.md`](../tests/ARCHITECTURE.md#adding-a-new-audit) has the
steps.

## Continuous integration

| Workflow | Purpose | Verified Result |
| --- | --- | --- |
| [`ci`](../.github/workflows/ci.yml) | Four independent jobs, no job waiting on another, so a failure always reports on its own required check. `build` runs the gate audits (source integrity, repository policy, documentation integrity, stylesheet lint) and then the registry publish gate `publish:check --no-sync` on the same artifact `build-static` ships (plus a CycloneDX SBOM on `main`). The `playwright` matrix runs `e2e` (cross-browser, three workers), `visual` (macOS Chromium baselines of the synthetic content in `tests/fixtures/content`, so a publish never moves one), and `edge`, which serves the build through the Cloudflare runtime with `wrangler pages dev` and asserts what only that runtime produces: the hash CSP covering every inline script and style, one identical policy on every request, the `_headers` security and cache rules, a real 404, the contact function's refusals, and byte-exact `security.txt`, all before anything deploys. | Green checks on the committed tree, SBOM artifact on `main`, and a summary on every job. |
| [`deploy`](../.github/workflows/deploy.yml) | Starts when Cloudflare Pages reports its check-run complete (nothing polls). Runs `deploy-verify --origin` against that deployment's own `*.pages.dev` URL (headers, inline-code hash coverage, cache rules, every sitemap route, 404, contact refusal, `security.txt`), and keeps one pull-request comment current with the CI summaries and the deployment result, whichever finishes first. Also recovers the CI run GitHub suppresses after a Dependabot auto-merge. | One updating PR comment; a verification summary for every deployment. |
| [`codeql`](../.github/workflows/codeql.yml) | Scans the TypeScript for semantic vulnerabilities; skipped (reported as passing) on pull requests that touch only content. | Zero open CodeQL alerts. |
| [`dependency review`](../.github/workflows/dependency-review.yml) | Audits manifest package updates for high-severity advisories; skipped on content-only pull requests; comments only when it blocks. | Pull request status validation. |
| [`release`](../.github/workflows/release.yml) | On a signed version tag: builds the tagged commit, packages the build output and a CycloneDX SBOM, and attests both through Sigstore. | A GitHub release whose files verify with `gh attestation verify`. |
| [`npm audit`](../.github/workflows/npm-audit.yml) | Weekly `npm run audit` of the lockfile, for advisories published against what is already installed. Accepted advisories live in [`.github/audit-allowlist.json`](../.github/audit-allowlist.json), each with a `reviewBy` date. | Fails on a high or critical advisory that is not accepted, or accepted past its review date. |
| [`scorecard`](../.github/workflows/scorecard.yml) | Computes OpenSSF security scorecard health metrics. | Weekly SARIF supply-chain reports. |
| [`workflow lint`](../.github/workflows/workflow-lint.yml) | Lints GitHub Action runner steps using actionlint. | PR/push syntax validation. |
| [`link check`](../.github/workflows/link-check.yml) | Audits all Markdown documentation and public links via Lychee. | Detailed connectivity report artifacts. |
| [`lighthouse`](../.github/workflows/lighthouse.yml) | Weekly Lighthouse run (the lockfile's Lighthouse, the same generation PageSpeed Insights scores with) against the live homepage and a deep writeup page. | Fails below accessibility 95 or SEO 90; warns below performance 85 or best practices 70. Scores in the job summary, reports as artifacts. Best practices reads in the 70s from any client Cloudflare distrusts, because Bot Fight Mode's injected detection script uses deprecated browser APIs; PageSpeed Insights is not served that script and reports 100. |
| [`dependabot auto-merge`](../.github/workflows/dependabot-auto-merge.yml) | Enables squash auto-merge on Dependabot's minor and patch PRs, except `sitedrift` (bundled into the edge functions); GitHub merges once every required check passes. | Dependency updates land without waiting on a manual merge. |
| [`dependabot stale`](../.github/workflows/dependabot-stale.yml) | Weekly: opens an issue listing Dependabot PRs open longer than seven days, so a wedged auto-merge is never silent. | Self-closing issue labelled `dependabot-stale`. |

Workflow hardening (pinned actions, job-scoped permissions, credential-free
checkouts) is in [Security](./Security.md#supply-chain-and-ci).

## Documentation

Docs change in the same commit as the code they describe. `npm run check:docs`
fails when a relative link, anchor, image, `npm run` reference, or backticked
repo path points at nothing. The command overview and the audit tables are
generated: `npm run sync:docs`.
