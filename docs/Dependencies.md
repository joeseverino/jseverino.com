# Dependencies

How dependencies are updated, the runtime pins, the packages held below their
latest major on purpose, and how an update is reviewed before it merges.

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
- Renovate's mise manager moves each mise tool, Node included, across
  `mise.toml` and `mise.lock` together.
- Commits go through GitHub's API, so they carry the signature the `main`
  ruleset requires. Nothing merges on its own: each pull request runs the
  required checks and is merged like any other.

`mise run checks:renovate` checks a change to the file with Renovate's own
validator, at the release the task pins.

## Runtime and package manager

Node is pinned once, in [`mise.toml`](../mise.toml): an exact LTS release.
`engines.node` in `package.json` names the same major, and `packageManager`
pins the npm release that Node version bundles, so a fresh install of the
pinned Node needs nothing else. `mise run checks:repo-policy` fails when the
running Node's major.minor or npm's major disagrees with them. Patch drift passes, so a Node security
release does not block the gates before the pin moves.

CI installs Node from `mise.toml` and `mise.lock` through `jdx/mise-action`,
so a bump moves every workflow at once. mise itself is pinned once, by
`min_version` in `mise.toml`: it is the floor every machine must meet and the
release the setup action installs, and Renovate moves it after the same
release-age hold it gives every other update. A Node major also
moves `engines.node`, the npm major in `packageManager` and `@types/node`,
whose majors Renovate holds for that reason.

## Deliberate holds

Each hold is a rule in [`.github/renovate.json`](../.github/renovate.json): a major hold
disables the package's major updates, and the `wrangler` hold disables all of its updates.

| Package | Held at | Why | Revisit when |
| :--- | :--- | :--- | :--- |
| `typescript` | 6.x | `astro check` runs Astro's language tools, which load the TypeScript compiler API. TypeScript 7's native compiler does not ship that API as a drop-in replacement. | Astro's language tools support 7.x. |
| `@types/node` | 26.x | The types describe the Node runtime pinned in `mise.toml`; a newer major would type APIs that Node 26 does not have. | `mise.toml` moves to a newer Node major. |
| `wrangler` | 4.152.0, exact | `@astrojs/cloudflare` builds and runs dev through `@cloudflare/vite-plugin` 1.x, which pins its own `wrangler` and `miniflare` to exact releases. Any other `wrangler` installs a second copy of both and of the native `workerd` binary. | `@cloudflare/vite-plugin` pins a newer `wrangler`; this pin moves to the same release. |
| `npm` (`packageManager`) | 11.x | The pin names the npm release the pinned Node bundles. | `mise.toml` moves to a Node major that bundles a newer npm. |

## No overrides

`package.json` has no `overrides` block: the lockfile installs one copy each of
`esbuild`, `sharp`, `workerd`, `miniflare`, and `wrangler` across Astro, Vite, and
the Cloudflare adapter, which `checks:repo-policy` enforces. An override is added only for a
duplicate native binary or a split `esbuild`, with a row here naming the
dependent that pins it and the condition for removal.

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
