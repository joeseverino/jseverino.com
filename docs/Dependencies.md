# Dependencies

How dependencies are updated, the runtime pins, the packages held below their
latest major on purpose, the bridges that run a newest release beside the one
a dependent needs, and how an update is reviewed before it merges.

## Updates

Renovate is the only dependency updater, and
[`.github/renovate.json`](../.github/renovate.json) is its whole configuration here; Renovate
itself runs outside this repository, so no workflow carries it. The file extends
`config:best-practices` (actions and container images pinned by digest, a pin
update proposed for each development dependency `package.json` still declares
as a `^` range, weekly lock file maintenance; the lockfile fixes the installed
version either way) and adds
this repository's rules, each with a `description`:

- Every update short of a major waits 7 days after its release, npm included
  (the preset's own npm rule holds only three), then lands in one weekly pull
  request.
- Astro and its `@astrojs/*` integrations move in a pull request of their own,
  and so does `sitedrift`, which is bundled into the Worker. `@playwright/test`
  and the Playwright image the `e2e` job runs in move together, majors included,
  since the image's browsers serve only the release of the same version.
- Each major comes on its own, except the holds below, which are disabled.
- Renovate's mise manager moves each mise tool, Node and npm included, across
  `mise.toml` and `mise.lock` together.
- Commits go through GitHub's API, so they carry the signature the `main`
  ruleset requires. Nothing merges on its own: each pull request runs the
  required checks and is merged like any other.

`mise run checks:renovate` checks a change to the file with Renovate's own
validator, at the release the task pins.

## Runtime and package manager

Node and npm are pinned once, in [`mise.toml`](../mise.toml): Node an exact
LTS release, and npm the release mise installs beside it, locked in
`mise.lock`, in place of the one Node bundles. Renovate's mise manager moves
both with their `mise.lock` entries, and its npm manager writes
`package-lock.json` with the npm `mise.toml` names.
`mise run checks:repo-policy` fails when the running Node's major.minor
disagrees with `mise.toml` or the npm on `PATH` is not its release. Node's
patch drift passes, so a Node security release does not block the gates before
the pin moves.

[`.npmrc`](../.npmrc) sets `allow-remote=root`: npm refuses a tarball URL
dependency by default, and `severino-brand` installs from its GitHub release.

CI installs Node from `mise.toml` and `mise.lock` through `jdx/mise-action`,
so a bump moves every workflow at once. mise itself is pinned once, by
`min_version` in `mise.toml`: it is the floor every machine must meet and the
release the setup action installs, and Renovate moves it after the same
release-age hold it gives every other update, in a pull request of its own
(`.github/renovate.json` says why). A Node major also
moves `@types/node`, whose majors Renovate holds for that reason.

## Deliberate holds

Each hold is a rule in [`.github/renovate.json`](../.github/renovate.json), whose
`description` gives the reason: a major hold disables the package's major updates,
and the `satteri` hold caps its 0.x line.

| Package | Held at | Revisit when |
| :--- | :--- | :--- |
| `@types/node` | 26.x | `mise.toml` moves to a newer Node major. |
| `satteri` | 0.11.x | `@astrojs/markdown-satteri` depends on a newer satteri. |

## Bridges

A dependent that lags a package's newest release gets a bridge in place of a
hold, so the repository runs the newest: the vendor's alias pair, or an npm
override in `package.json`.

| Package | Bridge | Remove when |
| :--- | :--- | :--- |
| `typescript` | `typescript` is the alias `npm:@typescript/typescript6` and `@typescript/native` is `npm:typescript@7`: `tsc` is TypeScript 7, and `@astrojs/check`, which declares `typescript ^5.0.0 \|\| ^6.0.0` and loads the compiler API 7.0 does not ship, imports 6. | `@astrojs/check` supports TypeScript 7, or TypeScript 7.1 ships its compiler API. |
| `wrangler`, `miniflare` | `@cloudflare/vite-plugin`, which the adapter builds and runs dev through, pins both exactly, behind wrangler's releases. `overrides` gives it `$wrangler`, the root pin, and that wrangler's `miniflare`, which Renovate moves in the same pull request. | `@cloudflare/vite-plugin` pins the root `wrangler` or a newer one. |

## One copy of each toolchain package

The lockfile installs one copy each of `esbuild`, `sharp`, `workerd`,
`miniflare`, and `wrangler` across Astro, Vite, and the Cloudflare adapter,
which `checks:repo-policy` enforces. A second copy is settled by a pin, a hold
or a bridge above, then `npm dedupe`: an update applied to an existing lock can
leave a nested copy of a package the new versions already share. An override is
added only for a duplicate native binary or a split `esbuild`, with a row under
Bridges naming the dependent that pins it and the condition for removal.

## Advisories

GitHub's vulnerability alerts are on, and Renovate reads them and the OSV
database: a fix for a known advisory opens at once, outside the weekly schedule
and the 7-day hold. Dependabot security updates are off, so the fix arrives
once, from Renovate. An advisory with no fixed release to take is accepted by
dismissing its alert with a reason, which keeps the decision beside the alert
in the repository's security tab.

## Reviewing an update

Every version change arrives as a Renovate pull request; none is installed by
hand, which would skip the release-age hold. Before merging one:

1. The lockfile diff keeps the platform binaries for both macOS and Linux (a
   lock regenerated on one platform can drop the other's).
2. The required checks pass, the visual baselines included. A browser upgrade
   can shift rendering; inspect any diff before regenerating a baseline.
3. For Astro or `sitedrift`, review the upstream release notes and the pull
   request's preview ([Deployment Preview Review](./Deployment-Preview-Review.md)).
