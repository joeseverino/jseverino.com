# Dependency Overrides

`package.json` carries an `overrides` block that pins transitive dependencies
to a floor. npm has no place for a reason beside an override, so the reasons
live here. Every entry names the commit that introduced it and the condition
under which it can go, so a quarterly pass is a checklist rather than
archaeology.

| Package | Floor | Introduced | Why | Remove when |
| :--- | :--- | :--- | :--- | :--- |
| `yaml` | `^2.9.0` | `c1dfd61` (2026-05-27) | Raised past a published advisory in a transitive `yaml` while the direct dependency's range still admitted the vulnerable release. | `npm ls yaml` resolves every path at or above the floor without the override. |
| `vite` | `^8.0.13` | `380b235` (2026-06-17) at `^7.3.5`, raised to `^8` in `fc35536` (2026-07-01) | Astro major upgrades have needed Vite pinned ahead of Astro's own range for the build to succeed; the `esbuild` `cssMinify` path depends on it. | The next Astro major declares the Vite range this repo needs on its own. |
| `esbuild` | `^0.28.1` | `380b235` (2026-06-17) | Companion to the Vite floor: keeps `cssMinify: 'esbuild'` on a release that handles the site's CSS. | Same condition as `vite`. |
| `js-yaml` | `^4.3.1` | `380b235` (2026-06-17) | Advisory floor on the `js-yaml` that `stylelint` and friends pull in. | `npm ls js-yaml` resolves at or above the floor without the override. |
| `fast-uri` | `^3.1.7` | `5fbbb5b` (2026-07-25), raised 2026-09-05 | Four high-severity advisories (host confusion, SSRF via IPv6 and percent-decoding, skipped IDN canonicalization) below 3.1.6. | `npm ls fast-uri` resolves at or above the floor without the override. |
| `nanoid` | `^3.3.17` | `94dbe9f` (2026-08-09) | Advisory floor on the `nanoid` 3.x line that a build-time dependency still requires. | The dependent moves to `nanoid` 5, or `npm ls nanoid` resolves at or above the floor without the override. |
| `postcss` | `^8.5.18` | `5fbbb5b` (2026-07-25) | Advisory floor on the `postcss` that `stylelint` and Astro's CSS pipeline share. | `npm ls postcss` resolves at or above the floor without the override. |
| `svgo` | `^4.0.2` | `5fbbb5b` (2026-07-25) | Advisory floor on `svgo` beneath the icon and Open Graph generators. | `npm ls svgo` resolves at or above the floor without the override. |

## Testing whether an override still matters

1. Delete the entry from `overrides`.
2. `npm install`, then `npm ls <package>` and confirm every resolved copy meets the old floor.
3. `npm audit --audit-level=high` stays clean.
4. `npm run publish:check -- --no-sync` passes, which covers the build-tool floors.

If all four hold, the override is dead weight: commit its removal. If any fails,
restore it and update the row above with what still requires it.
