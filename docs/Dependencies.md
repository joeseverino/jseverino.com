# Dependencies

How dependencies are updated, the runtime pins, the packages held below their
latest major on purpose, and how to test an upgrade before taking it.

## Updates

Renovate is the only dependency updater, and
[`renovate.json`](../renovate.json) is its whole configuration here; Renovate
itself runs outside this repository, so no workflow carries it. The file extends
`config:best-practices` (actions and container images pinned by digest,
development dependencies pinned exactly, weekly lock file maintenance) and adds
this repository's rules, each with a `description`:

- Every update short of a major waits 7 days after its release, npm included
  (the preset's own npm rule holds only three), then lands in one weekly pull
  request.
- Astro and its `@astrojs/*` integrations move in a pull request of their own,
  and so does `sitedrift`, which is bundled into the production edge functions.
- Each major comes on its own, except the holds below, which are disabled.
- Node moves as one update across `mise.toml`, `mise.lock` and `.nvmrc`.
- Commits go through GitHub's API, so they carry the signature the `main`
  ruleset requires. Nothing merges on its own: each pull request runs the
  required checks and is merged like any other.

`npx --package renovate@<version> -- renovate-config-validator --strict
--no-global renovate.json` checks a change to the file.

## Runtime and package manager

Node comes from [`mise.toml`](../mise.toml), an exact LTS release, and the same
version is in [`.nvmrc`](../.nvmrc) for Cloudflare Pages. `engines.node` in
`package.json` names the same major, and `packageManager` pins the npm release
that Node version bundles, so a fresh install of the pinned Node needs nothing
else. `mise run checks:repo-policy` fails when the two Node pins differ, or the
running Node's major.minor or npm's major disagrees with them. Patch drift passes, so a Node security
release does not block the gates before the pin moves.

CI installs Node from `mise.toml` and `mise.lock` through `jdx/mise-action`,
so a bump moves every workflow at once. mise itself has no pin: the action
installs the newest release at least seven days old (its
`minimum_release_age`), the same hold Renovate gives every other update, and
`min_version` in `mise.toml` is the floor every machine must meet, raised by
hand to a release at least that old. Renovate proposes a Node update as one
pull request across `mise.toml`, `mise.lock` and `.nvmrc`. A Node major also
moves `engines.node`, the npm major in `packageManager` and `@types/node`,
whose majors Renovate holds for that reason.

## Deliberate holds

Each hold is a rule in [`renovate.json`](../renovate.json) that disables the
package's major updates.

| Package | Held at | Why | Revisit when |
| :--- | :--- | :--- | :--- |
| `typescript` | 6.x | The audits and the site CLI call the TypeScript compiler API (scanner and program APIs), and Astro's language tools load it. TypeScript 7's native compiler does not ship that API as a drop-in replacement. | Astro's tooling and the compiler API used by `tests/audits` support 7.x. |
| `@types/node` | 24.x | The types describe the Node runtime pinned in `.nvmrc`; a newer major would type APIs that Node 24 does not have. | `.nvmrc` moves to a newer Node major. |
| `npm` (`packageManager`) | 11.x | The pin names the npm release the pinned Node bundles. | `.nvmrc` moves to a Node major that bundles a newer npm. |

## No overrides

`package.json` has no `overrides` block. Earlier `esbuild` and `sharp`
overrides forced one copy of each across Astro, Vite, and `wrangler`; with the
current releases, `npm ls esbuild sharp` resolves a single version of each
without them, so both were removed. If a future release brings back a
duplicate native binary or a split `esbuild`, add the override back with a
row here naming the dependent that pins it and the condition for removal.

## Advisories

GitHub's vulnerability alerts are on, and Renovate reads them and the OSV
database: a fix for a known advisory opens at once, outside the weekly schedule
and the 7-day hold. Dependabot security updates are off, so the fix arrives
once, from Renovate. An advisory with no fixed release to take is accepted by
dismissing its alert with a reason, which keeps the decision beside the alert
in the repository's security tab.

## Testing an upgrade

1. `npm install <package>@<version>` (never delete `package-lock.json`; a lock
   regenerated on macOS drops the Linux platform binaries CI needs).
2. `npm ls <package>` shows one resolved copy, and `npm outdated` lists only
   the holds above.
3. `npm audit` reports nothing beyond the dismissed alerts.
4. `mise run ci` passes, including the visual baselines. A browser
   upgrade can shift rendering; inspect any diff before regenerating.
