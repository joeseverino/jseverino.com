# jseverino.com

[![ci](https://github.com/joeseverino/jseverino.com/actions/workflows/ci.yml/badge.svg)](https://github.com/joeseverino/jseverino.com/actions/workflows/ci.yml)
[![codeql](https://github.com/joeseverino/jseverino.com/actions/workflows/codeql.yml/badge.svg)](https://github.com/joeseverino/jseverino.com/actions/workflows/codeql.yml)
[![scorecard](https://github.com/joeseverino/jseverino.com/actions/workflows/scorecard.yml/badge.svg)](https://github.com/joeseverino/jseverino.com/actions/workflows/scorecard.yml)

My cybersecurity portfolio: writeups, projects, and a resume, written in a
private Obsidian vault and published as a static Astro site on Cloudflare.

![Obsidian vault, synced into this repo, built by Astro, served by Cloudflare Pages](./docs/diagrams/system-shape.png)

<sup>Diagram source: [`docs/diagrams/system-shape.mmd`](./docs/diagrams/system-shape.mmd),
pre-rendered with [`diagram`](https://github.com/joeseverino/tools/blob/main/bin/diagram).</sup>

This repository is the public build source. The vault stays private: a sync
step projects only published content through a declared contract, and
Cloudflare builds from what is committed here, with no access to the vault and
no secrets.

## Stack

| | |
| :--- | :--- |
| Site | [Astro 7](https://astro.build), static output, Markdown rendered through an allow-list |
| Language | TypeScript everywhere, run directly by Node 24 (no build step for scripts) |
| Edge | Cloudflare Pages Functions: per-request CSP nonces, the contact form, CSP reporting |
| Data | Cloudflare D1 for contact submissions and CSP reports, behind Turnstile |
| Zone | WAF, rate limiting, redirects, and Turnstile declared in [`cloudflare/zone.json`](./cloudflare/zone.json) and applied by `npm run cloudflare:apply` |
| Previews | Behind Cloudflare Access, reviewed with [sitedrift](https://github.com/joeseverino/sitedrift) |
| Brand | Icons and social cards rendered by [branding-engine](https://github.com/joeseverino/branding-engine) |
| Tests | Node's test runner, Playwright on Chromium, Firefox, and WebKit, the Cloudflare runtime through `wrangler pages dev`, and source and build audits |

## Security

- No origin server, database-backed pages, admin panel, or accounts. The
  dynamic surface is a handful of small Functions.
- A fresh CSP nonce on every HTML response, applied only to tags the build
  marked, so markup that arrives through content never runs.
- Contact submissions are verified with Turnstile (hostname and action), checked
  against a contract, and rate-limited inside the D1 statement.
- Every deployment is verified by the default branch's code: headers, nonce,
  cache rules, and every sitemap route.

The design is in [`docs/Security.md`](./docs/Security.md); reporting is in
[`SECURITY.md`](./SECURITY.md).

## Performance

PageSpeed Insights scored the homepage 100 in every category on desktop and
99 / 100 / 100 / 100 on mobile (2026-09-05). The build enforces it: every page
has a weight budget for HTML, CSS, and JavaScript, images ship as AVIF and WebP
with fixed dimensions, and a weekly Lighthouse run fails below 95 on
accessibility.

## Verify it yourself

Every claim above can be checked from outside:

```sh
# A new CSP nonce on every request
for i in 1 2; do curl -sI https://jseverino.com/ | grep -io -m1 "nonce-[^']*" | head -1; done

# The disclosure policy is clear-signed; the key comes from Web Key Directory
gpg --auto-key-locate clear,wkd --locate-keys security@jseverino.com
curl -s https://jseverino.com/.well-known/security.txt | gpg --verify
```

- [MDN HTTP Observatory](https://developer.mozilla.org/en-US/observatory/analyze?host=jseverino.com):
  A+, 145 / 100, 12 of 12 tests on 2026-10-03.
- [OpenSSF Scorecard runs](https://github.com/joeseverino/jseverino.com/actions/workflows/scorecard.yml)
  and [CodeQL](https://github.com/joeseverino/jseverino.com/actions/workflows/codeql.yml)
  publish their results to code scanning.
- Every commit on `main` is signed and every change lands through a pull
  request with required checks; each `main` build attaches a CycloneDX SBOM.
- [`docs/Security.md`](./docs/Security.md#external-verification) records each
  scanner result with its date and what was reviewed.

## Repository

```text
src/          Astro pages, components, and the synced content
functions/    Pages Functions: CSP middleware, contact, CSP reports, preview review
public/       static assets, _headers, _routes.json, _redirects
cloudflare/   zone settings and the D1 schema, as code
contracts/    the content and contact contracts, and the generated OpenAPI
bin/          the site CLI, the content sync, generators, and checks
tests/        unit, audit, Playwright, and edge suites, and their configs
docs/         architecture, operations, and guides
```

## Working on it

```sh
npm ci
npm run dev              # local site
npm run publish:check    # the local gate: audits, types, build, edge suite
npm run site -- --help   # scaffold, validate, publish, and verify writeups
```

Content ships through the repo's own `site` CLI. `site publish` opens a pull
request from a clean worktree, and `site land` merges it once the checks pass,
then verifies the deploy live. `site manage` shows every writeup's order, state,
and gate issues on one screen.

![site manage: status dashboard with the dev server running, content counts, and the action list](./docs/images/site-cli/manage-site-tab-dev-running.png)

## Documentation

| | |
| :--- | :--- |
| [Architecture](./docs/Architecture.md) | build, content, rendering, images, and the edge |
| [Development](./docs/Development.md) | setup, code rules, gates, test policy, CI |
| [Security](./docs/Security.md) | the security design end to end |
| [Cloudflare](./docs/Cloudflare.md) | what runs where, free-plan limits, `cloudflare:check` and `apply` |
| [Vault Workflow](./docs/Vault-Workflow.md) | the private-to-public sync contract |
| [Site CLI](./docs/Site-CLI.md) | publishing and the `site manage` TUI |
| [Authoring Guide](./docs/Authoring-Guide.md) | the Markdown extensions |
| [Deployment Preview Review](./docs/Deployment-Preview-Review.md) | sitedrift on preview deployments |
| [SEO](./docs/SEO.md) · [Accessibility](./docs/Accessibility.md) | metadata, structured data, and accessibility |
| [Brand System](./docs/Brand-System.md) | one navy identity, rendered by a shared engine |
| [Commands](./docs/Commands.md) | every npm script |
| [Release Checklist](./docs/Release-Checklist.md) | releasing and verifying a deploy |
| [Dependencies](./docs/Dependencies.md) | why each `overrides` entry exists |
| [Blueprint Setup](./docs/Blueprint-Setup.md) | every instance-specific value, for reuse |
| [WordPress to Astro](./docs/WordPress-To-Astro-Migration.md) | why the site left WordPress, with measurements |

## License

All rights reserved; see [`LICENSE`](./LICENSE). The source is public to read
and review, not to copy or redistribute.
