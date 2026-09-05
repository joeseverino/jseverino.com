# Contributing

jseverino.com is a personal site with a single author. The repository is public
for transparency and review, not as an invitation to co-develop it, and
[`LICENSE`](./LICENSE) reserves all rights. Pull requests are not accepted.

Bug reports, security findings, and corrections are welcome, and they are the
most useful contribution this repository can receive.

## Reporting a bug

Open an issue on the
[issue tracker](https://github.com/joeseverino/jseverino.com/issues). A useful
report names the page URL, the browser and platform, and the observed versus
expected behavior. Screenshots help for layout and rendering problems.

Issues are read and triaged. Reproducible defects are fixed; requests to change
the site's content, structure, or editorial direction are generally declined,
since those are authorial choices rather than defects.

## Reporting a security issue

Do not open a public issue for a suspected vulnerability.
[`SECURITY.md`](./SECURITY.md) documents the private disclosure path, including
the OpenPGP key for encrypting sensitive exploit detail. The same path is
published machine-readably per RFC 9116 at
[`public/.well-known/security.txt`](./public/.well-known/security.txt).

## How changes are verified

Changes reach `main` through a pull request with green CI. Two gates run locally
before anything is pushed:

```
npm run publish:check   # audits, unit tests, astro check, production build
npm run release:check   # Playwright E2E, visual baselines, repository policy
```

`npm run diagnose` sequences the full set in one command.
[`tests/README.md`](./tests/README.md) explains how the gates fit together, and
[`docs/Commands.md`](./docs/Commands.md) lists every script.

CI enforces the same gate on every push and pull request, so a change that
passes locally and fails remotely indicates drift worth investigating rather
than a flaky check.

## Test policy

Major new functionality ships with automated coverage in the same change, and a
fix for a reproducible defect ships with a regression test. Choose the layer
that matches what changed:

| Change | Layer |
| :--- | :--- |
| Pure library logic | [`tests/unit/`](./tests/unit/) |
| An invariant about the source tree | [`tests/audits/`](./tests/audits/) |
| Rendered or interactive behavior | [`tests/playwright/`](./tests/playwright/) |

A new audit is registered in
[`tests/audits/registry.mjs`](./tests/audits/registry.mjs), the single source of
truth for which audits exist and which gate runs each. Registering it there is
what makes every gate pick it up at once, so no gate falls silently out of sync.

## Documentation

Public documentation ships in the same commit as the code it describes, never as
a follow-up. `npm run check:docs` asserts that every relative link, image, and
`npm run` reference in the engineering docs points at something that exists.
