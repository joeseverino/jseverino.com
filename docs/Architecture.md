# Master Technical Architecture: jseverino.com

This document provides a deep-dive into the engineering, security, and performance architecture of [jseverino.com](../). It describes a custom-built content delivery system optimized for high-performance edge delivery and a "Vault-as-CMS" authoring workflow.

---

## 1. Architectural Overview: The "No Origin" Model

The site is built on a **Security by Construction** philosophy. By utilizing **Static Site Generation (SSG)** with [Astro](../astro.config.mjs), we eliminate the traditional application server and database from the public attack surface.

*   **Unidirectional Data Flow**: Content flows from a private Obsidian vault -> public repository snapshot -> Cloudflare Pages Edge.
*   **Decoupled Rendering**: The build process transforms rich Markdown and custom directives into highly optimized, standard HTML/CSS.
*   **Edge Intelligence**: Dynamic logic (contact form) is isolated to Cloudflare Pages Functions, utilizing Cloudflare D1 for edge-based SQLite storage.

---

## 2. The Content Sync Engine ([`bin/sync-content.mjs`](../bin/sync-content.mjs))

The sync engine is an asynchronous Node.js pipeline responsible for the "Sanitization & Optimization" pass. It ensures that the public repository contains only the data necessary for the build.

### Asynchronous Pipeline
Refactored to use `fs.promises`, the engine performs non-blocking I/O operations for directory traversal, metadata parsing, and asset processing, maximizing performance during large content updates.

### Metadata Sanitization (Allowlist Strategy)
To prevent private vault data (IDs, internal notes, relationship tags) from leaking, the engine uses an **Allowlist Strategy**.
*   [`publicWriteupData()`](../bin/sync-content.mjs) and [`publicPageData()`](../bin/sync-content.mjs) functions explicitly extract only defined fields (`title`, `description`, `technologies`, etc.).
*   Any vault-specific metadata (e.g., `doc_id`, `system`, `related_projects`) is dropped by omission during the `matter.stringify` pass.

### Advanced Content Reconciliation
The engine implements custom logic like `stripRepeatedDescription()` to maintain SEO integrity. It uses a fixpoint iteration algorithm to strip HTML-tag-like sequences and reconcile descriptions that may have been duplicated between frontmatter and the body prose during authoring.

---

## 3. The Transformation Layer ([`src/lib/content.ts`](../src/lib/content.ts))

The "magic" of the site's rich content lies in a custom transformation layer built on top of `markdown-it`.

### Multi-Pass Block Engine
The library uses a series of regex-driven passes to transform Obsidian-style `::` directives into semantic HTML:
*   **Terminal Simulation**: `renderTerminal()` transforms blocks into macOS-style windows with traffic-light controls. It intelligently distinguishes between command lines (prefixed with `$`) and standard output.
*   **Layout Directives**: `renderSplit()` implements a responsive 2-column grid using `::split` and `:::` separators, allowing for sophisticated layouts directly from Markdown.
*   **Dynamic Component Injection**: `preprocessPageMarkdown()` detects placeholders (like `::featured-projects::`) and replaces them with data-bound Astro components at build-time.

### Renderer Rule Overrides
We extend the base `markdown-it` renderer to enforce engineering standards:
*   **Striped Tables**: The `table_open` rule is overridden to wrap every table in a `<figure class="table-figure table-figure--striped">`. This ensures responsive horizontal scrolling and consistent styling without manual class application.
*   **Intelligent Figures**: Standard Markdown images are promoted to `<figure>` elements if alt text is present, supporting advanced syntax like `![Caption|width|nocap]` for fine-grained layout control.

---

## 4. High-Performance Image Pipeline

The image pipeline is engineered to achieve a **Perfect 100 Performance Score** by solving the two hardest problems in web imaging: weight and layout shift.

### The Optimization Matrix
Every source image processed by [`bin/sync-content.mjs`](../bin/sync-content.mjs) is converted into a matrix of variants:
*   **Tiered Formats**: **AVIF** (Priority), **WebP** (Secondary), and an optimized **Raster Fallback** (JPEG/PNG).
*   **Tiered Widths**: Automatically generated at 512px, 1024px, and 1600px breakpoints.

### Hash-Based Content Addressing (Caching)
To ensure fast re-syncs, images are cached in `node_modules/.cache/jseverino-img` using **SHA-256 content hashes**. If the source image hasn't changed, the engine skips the expensive re-encoding pass and copies the cached variant directly.

### Zero Cumulative Layout Shift (CLS)
We eliminate layout shift through **Intrinsic Dimension Tracking**:
1.  During sync, **Sharp** extracts the original width/height of every image.
2.  This data is written to [`src/lib/image-manifest.json`](../src/lib/image-manifest.json).
3.  The [`src/components/Picture.astro`](../src/components/Picture.astro) component looks up these dimensions and sets explicit `width` and `height` attributes on the `<img>` tag, allowing the browser to reserve space before the image is even downloaded.

---

## 5. Security & Edge Infrastructure

### Nonce-Based CSP ([`functions/_middleware.ts`](../functions/_middleware.ts))
The site enforces a **Strict Content Security Policy** without sacrificing functionality:
*   **Dynamic Nonce**: Every response generated by Cloudflare Pages is assigned a unique cryptographic nonce.
*   **HTMLRewriter**: This edge-based utility scans the HTML stream and injects the nonce into every `<script>` tag.
*   **Headers**: The `Content-Security-Policy` header (defined in [`public/_headers`](../public/_headers)) is emitted with the matching nonce, blocking all XSS and unauthorized script injection.

### Secure Dynamic Boundary ([`functions/api/contact.ts`](../functions/api/contact.ts))
The contact form is the only non-static surface. It is protected by:
*   **Cloudflare Turnstile**: Zero-friction bot challenge.
*   **Cloudflare D1**: SQL injection protection via parameterized queries and edge-based storage.
*   **Rate Limiting**: IP-based throttling enforced at the middleware layer.

---

## 6. CI/CD & Operational Integrity

The build pipeline ([`bin/publish-check.mjs`](../bin/publish-check.mjs)) acts as the final quality gate:
*   **Stale Hash Guard**: Verifies that the inline script hashes in the production headers match the actual build output.
*   **Asset Audit**: Automatically fails the build if any image exceeds a 1.5MB weight threshold or if sitemaps are inconsistent.
*   **iCloud Conflict Resolution**: [`bin/clean-generated.mjs`](../bin/clean-generated.mjs) ensures that development in an iCloud-synced environment doesn't result in duplicate or stale files shipping to production.

---

## Related Documentation
*   [Vault-as-CMS Workflow](./Vault-Workflow.md) — Detailed sync lifecycle and content organization.
*   [Authoring Guide](./Authoring-Guide.md) — Manual for custom Markdown directives and components.
*   [Technical SEO & Metadata](./SEO.md) — Deep dive into search and social optimization.
*   [Security Posture](../SECURITY.md) — Master threat model and security architecture.
