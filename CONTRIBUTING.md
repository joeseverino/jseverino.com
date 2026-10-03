# Contributing

jseverino.com is a personal site with a single author. The repository is public
for transparency and review, and [`LICENSE`](./LICENSE) reserves all rights.
Pull requests are not accepted.

Bug reports, security findings, and corrections are welcome.

## Reporting a bug

Open an issue on the
[issue tracker](https://github.com/joeseverino/jseverino.com/issues). A useful
report names the page URL, the browser and platform, and the observed versus
expected behavior. Screenshots help for layout and rendering problems.

Issues are read and triaged. Reproducible defects are fixed. Requests to change
the site's content, structure, or editorial direction are usually declined.

## Reporting a security issue

Do not open a public issue for a suspected vulnerability.
[`SECURITY.md`](./SECURITY.md) documents the private disclosure path, including
the OpenPGP key for encrypting sensitive exploit detail. The same path is
published machine-readably per RFC 9116 at
[`public/.well-known/security.txt`](./public/.well-known/security.txt).

## How changes are verified

Changes reach `main` through a pull request with green CI. The local gates:

```
npm run gate:check      # fast invariants: types, policy, docs, lint, duplication
npm run publish:check   # audits, unit tests, astro check, production build, post-build audits
npm run release:check   # publish:check, then Playwright, visual baselines, the edge suite
```

`npm run diagnose` runs every audit in one pass and reports every failure.
[`tests/README.md`](./tests/README.md) explains how the gates fit together, and
[`docs/Commands.md`](./docs/Commands.md) lists every script.

CI runs `gate:check` and `publish:check` on pushes to `main`, pull requests to
`main`, and manual dispatch, plus the browser and edge suites. A change that passes locally and fails in CI points at
a difference between the two environments; `npm run publish:check:ci` rehearses
the CI conditions locally.

## Code

Everything is TypeScript, run directly by Node 24, which strips the types: no
build step and no loader. That rules out syntax Node cannot strip (enums,
namespaces, parameter properties), so `erasableSyntaxOnly` is on, and every
relative import names its `.ts` file. `npm run typecheck` is the one strict
check over the repo; `astro check` covers the `.astro` files. Shared logic lives
once, in `bin/lib/`, `src/lib/`, `functions/lib/`, or a test helper, and the
gate fails on duplicated code.

## Test policy

Major new functionality ships with automated coverage in the same change, and a
fix for a reproducible defect ships with a regression test. Choose the layer
that matches what changed:

| Change | Layer |
| :--- | :--- |
| Pure library logic | [`tests/unit/`](./tests/unit/) |
| An invariant about the source tree | [`tests/audits/`](./tests/audits/) |
| Rendered or interactive behavior | [`tests/playwright/`](./tests/playwright/) |
| Headers, CSP, or Functions as Cloudflare serves them | [`tests/edge/`](./tests/edge/) |

A new audit is registered in
[`tests/audits/registry.ts`](./tests/audits/registry.ts), which lists every
audit and the gates that run it; every gate reads that list.
[`tests/ARCHITECTURE.md`](./tests/ARCHITECTURE.md#adding-a-new-audit) has the steps.

## Documentation

Documentation changes ship in the same commit as the code they describe.
`npm run check:docs` fails when a relative link or anchor, image, `npm run` reference, or
backticked repo path in the engineering docs points at nothing. The command
overview and the audit tables are generated: `npm run sync:docs`.
