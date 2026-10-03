# Dependency Overrides

`package.json` carries an `overrides` block that forces the version of a
transitive dependency. npm has no place for a reason beside an override, so the
reasons live here, each with the commit that introduced it and the condition
under which it can go.

| Package | Value | Introduced | Why | Remove when |
| :--- | :--- | :--- | :--- | :--- |
| `esbuild` | `^0.28.2` | `048b858` (2026-10-02) | `wrangler` pins an exact `esbuild` 0.28.1; the override gives Astro, Vite, and `wrangler` one copy at the floor the build uses (`cssMinify: 'esbuild'`). | `wrangler` declares a range that admits the version Astro resolves, and `npm ls esbuild` shows one copy without the override. |
| `sharp` | `$sharp` | `048b858` (2026-10-02) | `miniflare` (under `wrangler`) pins an exact `sharp`; the override makes every dependent use the direct `sharp` devDependency, so one native binary is installed. | `npm ls sharp` shows one copy without the override. |

A high or critical advisory with no fixed release is accepted,
with a reason and a review date, in
[`security/audit-allowlist.json`](../security/audit-allowlist.json) rather than
pinned here.

## Testing whether an override still matters

1. Delete the entry from `overrides`.
2. `npm install`, then `npm ls <package>` and confirm one copy resolves at or above the old value.
3. `npm run audit` stays clean.
4. `npm run publish:check -- --no-sync` passes, which covers the build tools.

If all four hold, commit the removal. If any fails,
restore it and update its row with what still requires it.
