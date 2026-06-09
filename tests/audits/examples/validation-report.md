<!-- Example output of `npm run diagnose` against a failing tree, captured for
documentation. diagnose writes this file (.validation-report.md, gitignored) only
on failure and deletes it on success. See ../../ARCHITECTURE.md#1-the-gate-ladder. -->

# Codebase Diagnostics & Issues Report

> [!IMPORTANT]
> This report lists all logical failures detected in the codebase by running deterministic test scripts. Fix these issues prior to pushing or deploying.

## Validation Summary

| Check Name | Status | Duration | Recommendation |
| :--- | :--- | :--- | :--- |
| **Security Signatures** | ✅ PASS | 83ms | Run `npm run sign:security` to sign or re-sign `public/.well-known/security.txt` with the security@ key. |
| **WCAG Color Contrast** | ✅ PASS | 52ms | Adjust colors in `src/styles/base.css` to achieve >= 4.5:1 ratio, or register the custom pair in `tests/audits/check-contrast.mjs`. |
| **Vault/MCP/Code Parity** | ✅ PASS | 53ms | Ensure the vault frontmatter schema (`Frontmatter Schema.md`), Zod schema (`src/content.config.ts`), and the Python MCP server parameters agree on all fields. |
| **Sitedrift Preview Guard** | ✅ PASS | 211ms | Check `tests/audits/check-sitedrift-preview.mjs`. SiteDrift proxy wrapping must be active on feature branches and absent on main. |
| **Repository Policy** | ✅ PASS | 88ms | Align Node version (.nvmrc), lockfile dependencies, commit hashes for GitHub Actions, or run `npm run clean:conflicts` to remove iCloud conflict copies. |
| **Docs Link Integrity** | ❌ FAIL | 68ms | A doc links to a renamed/removed file or an npm script that no longer exists. Fix the reference at the reported file:line, or restore the target. |
| **Stylelint CSS Check** | ✅ PASS | 1077ms | Fix syntax and rule violations in your CSS files located under `src/styles/`. |
| **CSS Unused Variables** | ❌ FAIL | 53ms | Remove declared CSS custom properties in `src/styles/` that are never referenced with `var(...)`. |
| **Astro Compiler Diagnostics** | ✅ PASS | 5019ms | Run `npx astro check` to debug TypeScript typing issues, content schemas, or file imports. |
| **Git Formatting/Conflicts** | ✅ PASS | 1423ms | Fix trailing whitespace, missing end-of-lines, or unresolved git conflict markers reported by `git diff --check`. |

---

## Failure Details & Resolution Paths

### ❌ Documentation Integrity (`docs-check`)

**Action Item**: A doc links to a renamed/removed file or an npm script that no longer exists. Fix the reference at the reported file:line, or restore the target.

**Error Output**:
```text
check-docs: documentation references that do not resolve:
  docs/SEO.md:153  broken link -> ../tests/audits/audit-css.mjs
```

### ❌ Unused CSS variables (`css-check`)

**Action Item**: Remove declared CSS custom properties in `src/styles/` that are never referenced with `var(...)`.

**Error Output**:
```text
Unused CSS custom properties:
  --color-legacy-accent (src/styles/base.css:1600)
```
