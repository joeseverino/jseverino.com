<!-- Example output of `npm run diagnose` against a failing tree, captured for
documentation. diagnose writes this file (.validation-report.md, gitignored) only
on failure and deletes it on success. See ../../ARCHITECTURE.md#1-the-gate-ladder. -->

# Diagnose report

## Summary

| Check | Status | Duration | Fix |
| :--- | :--- | :--- | :--- |
| No Duplicated Code | PASS | 473ms | Two places carry the same run of code. Extract one shared primitive (bin/lib, src/lib, functions/lib, or a test helper) and import it from both; generated files and test content are exempt in tests/audits/check-duplication.ts. |
| Generated Contract Projections | FAIL | 423ms | Regenerate the stale projection with the `run:` command it names (sync:tokens, sync:contract, sync:contact-openapi, make:embed, or sync:edge-site); generated artifacts must exactly match their canonical inputs. |
| No Drafts in the Snapshot | PASS | 110ms | A `published: false` document is in src/content, where it would deploy. Re-run `npm run sync:content`; preview drafts with `site dev --drafts`, which writes to the gitignored overlay. |
| Security Signatures | PASS | 165ms | Run `npm run sign:security` to sign or re-sign `public/.well-known/security.txt` with the security@ key. |
| WCAG Color Contrast | PASS | 76ms | The colors come from severino-brand through `npm run sync:tokens` (the token block in `src/styles/tokens.css` is generated): change the color upstream or the pairing in `src/styles/`. Register a new intended pair in `pairs` in `tests/audits/check-contrast.ts`. |
| Content Contract Parity | PASS | 87ms | Edit `contracts/content.v1.json`, run `npm run sync:contract`, and commit the generated schema. Never hand-edit a projection. |
| TypeScript Type Check | PASS | 8313ms | Run `npm run check:types`. One strict program covers bin/, src/, tests/, and the configs; functions/ compiles again under the Workers lib. `astro check` covers the .astro files. |
| Functions/Schema Parity | PASS | 94ms | The contact handler, `contracts/contact.openapi.json` (API Shield), and `cloudflare/d1.sql` (D1) disagree on fields, limits, or INSERT columns. Change all three together. |
| Sitedrift Preview Guard | PASS | 382ms | The sitedrift wrapper must be present on preview branches and absent on main. Check the build-static sitedrift step and `tests/audits/check-sitedrift-preview.ts`. |
| Unit Test Suite | PASS | 9935ms | Run `npm run test:unit` and reconcile the code or the expected behavior in the failing spec under `tests/unit/`. |
| Generated Documentation Blocks | PASS | 131ms | A generated block in docs/Commands.md or tests/ARCHITECTURE.md lags its source (the groups in bin/help.ts, the entries in tests/audits/registry.ts). Run `npm run sync:docs` and commit the result. |
| Docs Reference Integrity | PASS | 409ms | A doc links to a renamed/removed file or heading, names an npm script that no longer exists, or backticks a repo path git neither tracks nor ignores. Fix the reference at the reported file:line, or restore the target; an intentional example path goes in EXAMPLE_PATHS in tests/audits/check-docs.ts. |
| Stylelint CSS Check | PASS | 3334ms | Fix the reported Stylelint violations under `src/styles/`. |
| CSS Unused Variables | FAIL | 107ms | Remove the reported custom property from `src/styles/`, or add the `var(...)` use that needs it. |
| Astro Compiler Diagnostics | PASS | 4227ms | Run `npm run check:astro` and fix the reported .astro type, content-schema, or import error. |
| Repository Policy | PASS | 1611ms | Fix the reported rule: the Node and npm pins (.nvmrc, engines, packageManager), the lockfile, a tracked forbidden file, a stylesheet rule, a JavaScript file or explicit any, or a workflow (SHA pin, fixed runner, timeout-minutes). |
| Playwright Browser Revisions | PASS | 651ms | Install the browser revisions required by the lockfile with `npx playwright install chromium firefox webkit`. |
| Git Formatting/Conflicts | PASS | 195ms | Fix trailing whitespace, missing end-of-lines, or unresolved git conflict markers reported by `git diff --check`. |
| Worktree unchanged | PASS | 0ms | The run changed tracked files. Commit synced content or reset generated files, then rerun. |

## Failures

### Generated Contract Projections (`contract-projections`)

Fix: Regenerate the stale projection with the `run:` command it names (sync:tokens, sync:contract, sync:contact-openapi, make:embed, or sync:edge-site); generated artifacts must exactly match their canonical inputs.

Rerun: `node tests/audits/check-contract-projections.ts`

Output:
```text
embed CSS is stale
stale: public/embed/bundle.css
run: npm run -s make:embed
```

### CSS Unused Variables (`css-check`)

Fix: Remove the reported custom property from `src/styles/`, or add the `var(...)` use that needs it.

Rerun: `node tests/audits/check-css.ts`

Output:
```text
Unused CSS custom properties:
  --probe-unused (src/styles/layout.css:432)
```
