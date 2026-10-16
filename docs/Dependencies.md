# Dependencies

The runtime pins, the packages held below their latest major on purpose, and
how to test an upgrade before taking it.

## Runtime and package manager

Node comes from [`.nvmrc`](../.nvmrc), an exact LTS release. `engines.node` in
`package.json` names the same major, and `packageManager` pins the npm release
that Node version bundles, so a fresh install of the pinned Node needs nothing
else. `npm run check:repo-policy` fails when the running Node's major.minor or
npm's major disagrees with those pins. Patch drift passes, so a Node security
release does not block the gates before the pin moves.

CI reads the same `.nvmrc` through `actions/setup-node`, so bumping the file
moves every workflow at once.

## Deliberate holds

| Package | Held at | Why | Revisit when |
| :--- | :--- | :--- | :--- |
| `typescript` | 6.x | The audits and the site CLI call the TypeScript compiler API (scanner and program APIs), and Astro's language tools load it. TypeScript 7's native compiler does not ship that API as a drop-in replacement. | Astro's tooling and the compiler API used by `tests/audits` support 7.x. |
| `@types/node` | 24.x | The types describe the Node runtime pinned in `.nvmrc`; a newer major would type APIs that Node 24 does not have. | `.nvmrc` moves to a newer Node major. |

## No overrides

`package.json` has no `overrides` block. Earlier `esbuild` and `sharp`
overrides forced one copy of each across Astro, Vite, and `wrangler`; with the
current releases, `npm ls esbuild sharp` resolves a single version of each
without them, so both were removed. If a future release brings back a
duplicate native binary or a split `esbuild`, add the override back with a
row here naming the dependent that pins it and the condition for removal.

## Advisories

A high or critical advisory with no fixed release is accepted, with a reason
and a review date, in
[`.github/audit-allowlist.json`](../.github/audit-allowlist.json).
`npm run audit` fails when the entry expires or the audit itself errors.

## Testing an upgrade

1. `npm install <package>@<version>` (never delete `package-lock.json`; a lock
   regenerated on macOS drops the Linux platform binaries CI needs).
2. `npm ls <package>` shows one resolved copy, and `npm outdated` lists only
   the holds above.
3. `npm run audit` passes.
4. `npm run diagnose` passes, including the visual baselines. A browser
   upgrade can shift rendering; inspect any diff before regenerating.
