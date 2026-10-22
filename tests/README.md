# Tests & Validation

Every change passes four layers: Node audits that assert invariants about the
source and the build, unit tests for the pure logic, Playwright specs that drive
the **built** output in a browser and through the Cloudflare runtime, and
post-deploy probes against each deployment. This directory holds the first
three; [`mise.toml`](../mise.toml) names each one a gate and sequences them.

> This file is the tour. Every audit with its fix, every spec, and the CI
> workflows are in the full reference: **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

```
tests/
├── audits/        Node checks: assert an invariant, exit non-zero with the fix on failure
├── unit/          node:test specs for pure logic (Markdown DSL, API handlers, process harness, audit rules)
├── edge/          request specs against the build served by astro preview (API routes, _headers, built policy)
├── playwright/    browser specs against the build served by astro preview
└── fixtures/      the synthetic content the visual suite builds
```

Each check is a mise task named `<job>:<gate>` (`checks:*` before the build,
`built:*` on it, `browser:*` in a browser), and each aggregate runs its job by
glob, so a new task runs locally and in CI with no second list to edit.

## How it fits together

The [validation flow](../docs/Development.md#gates) traces a change from the
local gates through the pull request's CI and preview to production.

| Gate | Runs | Covers |
| :--- | :--- | :--- |
| `mise run fast` | local | the static gates: duplication, types, repository policy, docs, CSS lint, unit tests, `astro check`, the draft guard |
| `mise run check` | local and CI (`build`) | the static gates, the production build, then page and image weight, internal links, structural HTML, the built headers, and SEO |
| `mise run browser` | local and CI (`e2e`, `visual`, `edge`) | one build, then the cross-browser, visual, and edge runtime suites, one at a time |
| `mise run deploy:verify` | after a deploy | live headers and CSP hash coverage of inline code, sitemap 200s, a real 404, the contact gate, `security.txt` parity; on production also remote CI status and open CodeQL alerts |

Every gate with what it asserts is the generated [task list](../docs/Commands.md#every-task).
`mise run ci` runs `check` and then `browser`: every gate the pipeline runs.
Each phase keeps going past a failure and ends on the gates that failed; each
failing gate prints its own fix.

## The layers

**[`tests/audits/`](./audits/)**: Node checks with no browser. Before the build
they cover the signed `security.txt`, the contact
contract's handler/OpenAPI/D1 parity, strict types, duplicated
code, unused CSS variables, repository policy, and the docs' links and paths.
After the build they cover internal links, page and image weight, structural HTML
(including unprocessed directives), the built headers, and SEO metadata.
The [task list](../docs/Commands.md#every-task) says what each one asserts; a failing one prints its fix.

**[`tests/unit/`](./unit/)**: `node:test` specs for pure logic, no browser and no
build. The [content renderer](./ARCHITECTURE.md#the-unit-layer) in
[`src/lib/markdown/`](../src/lib/markdown/) is pinned block by block to the
HTML it must produce, and its guard to what it refuses. The API handlers (contact, CSP report
endpoint) and the preview proxy run request in, response out, with D1 and
Turnstile stubbed. The process harness, the `site` CLI's publish and
land flows, and each audit's rule are tested too. Node runs the specs directly
by stripping types.

**[`tests/edge/`](./edge/)**: the build served by `astro preview`, so the
API routes and `public/_headers` answer as they do on
Cloudflare. [Details](./ARCHITECTURE.md#the-edge-runtime-suite-testsedge).

**[`tests/playwright/`](./playwright/)**: specs against the compiled site. The
[routes suite](./ARCHITECTURE.md#routessinglespects) requests every URL in the
sitemap, so new writeups are covered automatically. Others drive the
[mobile drawer](./ARCHITECTURE.md#menumobilespects),
[accessibility and motion](./ARCHITECTURE.md#css-qualityspects), the
[Turnstile-gated contact form](./ARCHITECTURE.md#contactspects) (mocked API, no
backend), portfolio interactions, `rel=noopener`, and an
[axe-core WCAG A/AA sweep](./ARCHITECTURE.md#a11ysinglespects) over the key
page archetypes in both color schemes, color contrast included. The visual suite renders the fixture content only, so a
publish never moves a baseline.

## What it catches

A full Playwright run, reported:

<img src="./playwright/examples/playwright-html-report.png" alt="Playwright HTML test report" width="600">

Visual regression pins page and component screenshots to macOS Chromium baselines.
A stray header-height change, for example, is caught as a pixel diff before it can
merge:

| Expected | Actual | Diff |
| :---: | :---: | :---: |
| <img src="./playwright/examples/visual-diff/header-shift/expected.png" alt="Expected baseline" width="220"> | <img src="./playwright/examples/visual-diff/header-shift/actual.png" alt="Actual run" width="220"> | <img src="./playwright/examples/visual-diff/header-shift/diff.png" alt="Diff" width="220"> |

Functional failures screenshot the page at the moment of the failed assertion.
The full baseline gallery and more diff/failure examples are in
[ARCHITECTURE.md §5](./ARCHITECTURE.md#5-visual-regression).

## Run it

```sh
mise tasks                                   # every task with what it asserts or does

mise run fast                                # the static gates, collect-all
mise run check                               # + the build and every gate on it
mise run ci                                  # + the browser suites

mise run checks:unit                         # unit suite (fast, no browser)
mise run browser:edge                        # the edge runtime suite
mise run browser:e2e                         # functional specs across Chromium, Firefox, WebKit
mise run browser:visual                      # visual regression (macOS Chromium)
mise run browser:visual --update-snapshots   # re-baseline after an intentional design change
```

---

Full reference: [ARCHITECTURE.md](./ARCHITECTURE.md), with every audit and its
fix, every spec, post-deploy `deploy:verify`, and the CI workflows.
