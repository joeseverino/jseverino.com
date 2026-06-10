# Engineering Review & Optimization Blueprint

This review evaluates the architectural design, security gates, validation harness, and developer workflow of the `jseverino.com` repository. The goal is to evaluate its completeness and coherence, helping to refine it as a cornerstone engineering model for future projects (a reusable site blueprint).

---

## 1. Coherence & Repository Organization

Yes, this repository exhibits an exceptionally high degree of coherence. The architectural choices map logically to a modern, static-first developer workflow.

### Ⅰ. Structural Alignment
The folder layout is clean and self-documenting:
* **`bin/`**: Contains orchestration commands, local tools, and CLI gate runners.
* **`db/`**: Houses the SQL D1 schemas and migrations.
* **`docs/`**: Holds rich developer manuals (Architecture, Brand, SEO, Vault details).
* **`functions/`**: Contains Cloudflare Pages serverless middleware and API handlers.
* **`public/`**: Stores static assets (icons, PDFs, synced writeup image folders).
* **`src/`**: Houses the core Astro project (pages, components, layouts, styles, data layer).
* **`tests/`**: Organizes all validation scripts (divided cleanly into lightweight pre/post-build node `audits/` and functional/visual browser `playwright/` tests).

### Ⅱ. Naming & Extension Conventions
Naming conventions are uniform with clear, justified exceptions:
* **PascalCase** for Astro UI components (`ProjectCard.astro`, `SeoHead.astro`), matching community best practices.
* **kebab-case** for pages, content folders, and JavaScript/TypeScript utility files.
* **Check vs. Audit Prefixes**: In `tests/audits/`, the `check-` prefix indicates a gating script that exits non-zero on failure. The `audit-` prefix indicates a measurement script (`audit-assets.mjs`) that reports weights, and is only treated as a gate when specifically invoked in strict mode. This is an excellent, consistent convention.
* **The `.mjs` vs. `.ts` Hybrid**: Files in `src/lib/` are split: `content.ts` and `images.ts` are TypeScript, while `brand.mjs`, `site-config.mjs`, and `security-txt.mjs` are ES Modules. 
  * *Why?* Because raw Node.js audit scripts (like `check-contrast.mjs` and `check-security-txt.mjs`) need to import configuration and colors *before* the TypeScript compiler or Astro bundler runs. Keeping these config files as `.mjs` prevents needing a complex TS pre-compilation step in pre-build checks.
  * *Verdict:* This is a highly pragmatic and coherent engineering trade-off.

### Ⅲ. Minor Coherence Issues
* **The "Dark-Matter" Prose Audit**: `tests/audits/check-prose.mjs` exists to detect AI-buzzwords, but it is not registered in `package.json`, not mentioned in `tests/ARCHITECTURE.md`, and not referenced in `bin/help.mjs`. This makes it completely invisible to a new developer.
* **Content Coupling in Tests**: The E2E tests are tightly coupled to live blog posts (e.g. `/portfolio/building-a-custom-mcp-layer/`). If content is synced from the Obsidian vault, deleting or renaming those posts will break the code build, which violates clean separation of concerns (content vs. code).

---

## 2. Test Suite Completeness Analysis

The testing suite is incredibly thorough. It covers static file integrity, PGP security signatures, WCAG color contrast, schema parity, responsive image formats (AVIF/WebP), sitemap status codes, interaction locks, and visual regressions. 

To make it a true **engineering cornerstone** and prepare it for abstraction into a reusable blueprint, here are the missing coverage vectors:

### Ⅰ. Unit/Integration Testing (The DSL Gap)
* **What is missing:** There is no unit testing runner (like `vitest` or Node's native `node:test`).
* **Why it matters:** `src/lib/content.ts` implements a custom Markdown-extending DSL (`::terminal`, `::figure`, `::split`, `::buttons`, and `restoreFigures`). This custom parsing is complex. Right now, it is only tested indirectly through Playwright page assertions. 
* **Recommendation:** Add a lightweight unit test suite for `src/lib/content.ts` to test these helper functions directly with mock markdown inputs, guaranteeing parser correctness without launching a headless browser.

### Ⅱ. Dynamic / Decoupled Testing
* **What is missing:** The tests lack a stable playground.
* **Why it matters:** E2E and visual tests depend on live writeups. If writeup copy edits or image swaps alter the visual state of `/portfolio/building-a-custom-mcp-layer/`, visual regression fails.
* **Recommendation:** Set up a dedicated developer-only fixture page (e.g., `/tests/visual-fixture`) rendering all key UI components in a single stable viewport. This decouples test status from blog content changes.

### Ⅲ. Local Performance Auditing
* **What is missing:** Lighthouse audits are run via GitHub Actions (`lighthouse.yml`), but there is no automated local performance gating.
* **Recommendation:** Integrate a post-build lighthouse audit using `lhci` or a custom lighthouse script in the local diagnostic runner, ensuring page speeds never regress before push.

---

## 3. High-Impact Improvement Opportunities

### Ⅰ. Test & Build Performance (Redundant Compilation)
* **Issue:** `npm run diagnose` compiles the Astro site twice: once in Phase 3 (`npx astro build`) and once inside Playwright's `webServer.command` (`npm run build:static`).
* **Solution:** Set `SKIP_BUILD=1` in `diagnose.mjs` and configure `playwright.config.ts` to skip rebuilding if `process.env.SKIP_BUILD` is present.

### Ⅱ. Custom CSS Variable Scope Expansion
* **Issue:** `check-css.mjs` only scans `.css` files. Using custom CSS variables inside Astro templates or JS files flags them as "unused" and fails the build.
* **Solution:** Expand the regex parser in `check-css.mjs` to search `.astro`, `.js`, and `.ts` files when identifying used variables.

### Ⅲ. Robustness of Schema Parity Checking
* **Issue:** `check-vault-mcp-parity.mjs` parses the Zod schema in `src/content.config.ts` using literal index matching. Formatting edits or prettier runs will break the check.
* **Solution:** Refactor the parser to match `schema: z.object({ ... })` blocks using a more robust regex that ignores inline whitespace, line breaks, and comments.

### Ⅳ. Relaxing Node.js Version Locks
* **Issue:** `check-repository-policy.mjs` enforces exact Node.js patch version matching, causing friction for developers on minor patch increments.
* **Solution:** Relax the check to verify matching Major/Minor releases, allowing patch-version drift.

---

## 4. Action Plan Matrix

| Action Item | Target Area | Files Impacted | Implementation Strategy |
| :--- | :--- | :--- | :--- |
| **1. Skip redundant builds** | Performance | `bin/diagnose.mjs`, `playwright.config.ts` | Pass `SKIP_BUILD=1` in `diagnose.mjs` and modify Playwright configuration. |
| **2. Dynamic E2E pages** | Resiliency | `tests/playwright/*.spec.ts` | Dynamically resolve the first writeup slug from `src/content/writeups` folder. |
| **3. Dedicated visual regression sandbox** | DX & Stability | `src/pages/tests/visual-fixture.astro`, `tests/playwright/visual.spec.ts` | Create a test page rendering components; point visual snapshots to it. |
| **4. Enhance Schema parity parser** | Robustness | `tests/audits/check-vault-mcp-parity.mjs` | Refactor regex parser to strip comments and handle custom formatting. |
| **5. Expand CSS variable audit** | DX | `tests/audits/check-css.mjs` | Scan `.astro`, `.js`, and `.ts` files when compiling CSS variable usages. |
| **6. Expose check-prose** | Editorial | `package.json`, `bin/help.mjs`, `tests/ARCHITECTURE.md` | Register `audit:prose` and document it in the help menu and architecture files. |
| **7. Node.js patch tolerance** | DX | `tests/audits/check-repository-policy.mjs` | Update check to verify matching major/minor node versions instead of strict match. |
| **8. Introduce parser unit tests** | Testing | `package.json`, `tests/unit/parser.test.ts` | Add a lightweight test runner to unit-test custom Markdown DSL blocks directly. |
