# Technical Architecture: jseverino.com

This document details the internal engineering and delivery architecture of the site. It is designed for maximum performance (Core Web Vitals), [zero-origin security](../SECURITY.md), and an optimized [Vault-as-CMS workflow](./Vault-Workflow.md).

## 1. Core Stack
*   **Framework**: Astro (Static Site Generation - SSG).
*   **Deployment**: Cloudflare Pages (Edge delivery).
*   **Authoring**: Obsidian (Markdown) in a private vault.
*   **Processing**: Node.js scripts for content sync and image optimization.

## 2. The Content Pipeline
The site follows a strict **unidirectional data flow** as defined in the [Sync Contract](./Vault-Workflow.md#3-the-sync-contract):
1.  **Source**: Content is authored in a private vault with [custom directives](./Authoring-Guide.md).
2.  **Sync**: `bin/sync-content.mjs` pulls only `published: true` files into `src/content/`.
3.  **Sanitization**: Vault-only metadata (IDs, relationship tags) is stripped during sync to keep the public repo clean.
4.  **Transformation**: Astro transforms Markdown into static HTML using `markdown-it` with custom plugins for directives.

## 3. High-Performance Image Pipeline
Images are the primary driver of page weight. We use a custom **Sharp-powered pipeline** to automate [Technical SEO](./SEO.md) optimizations:
*   **Responsive Variants**: Every source image is converted into **AVIF** and **WebP** formats at 512px, 1024px, and 1600px widths.
*   **Zero Layout Shift**: A generated `image-manifest.json` stores intrinsic dimensions for every asset. The `Picture.astro` component uses this data to set explicit `width` and `height` attributes on the `<img>` tag, reserving space before the image loads.
*   **Lazy Loading**: Native `loading="lazy"` and `decoding="async"` are applied by default.

## 4. Security Architecture
The site is built on a **"No Origin"** model (see [Security Posture](../SECURITY.md)):
*   **Static Edge**: There is no application server or database behind the pages. Probes for `/wp-admin` or SQL injection land on static files.
*   **Dynamic Surface**: The only dynamic path is `/api/contact`, a Cloudflare Pages Function. It uses Cloudflare D1 (SQLite at the edge) for storage and Turnstile for bot protection.
*   **Nonce-based CSP**: A Cloudflare Pages Middleware (`functions/_middleware.ts`) generates a per-request nonce, injects it into every `<script>` tag via `HTMLRewriter`, and enforces a strict `Content-Security-Policy`. This prevents XSS without needing `'unsafe-inline'`.

## 5. Automation & CI
*   **Pre-push Audit**: `bin/publish-check.mjs` runs a full battery of tests:
    *   iCloud conflict cleanup.
    *   Astro diagnostics.
    *   Full static build.
    *   CSP hash verification.
    *   Asset weight audit (fails if any image exceeds 1.5MB).
*   **Identity**: Verified via `rel="me"` on social links for federated identity standards (see [Technical SEO](./SEO.md#4-security--crawling)).

---

## Related Documentation
*   [Technical SEO & Metadata](./SEO.md) — Deep dive into search and social optimization.
*   [Vault-as-CMS Workflow](./Vault-Workflow.md) — The sync contract and content lifecycle.
*   [Authoring Guide](./Authoring-Guide.md) — Documentation for custom Markdown extensions.
*   [Security Posture](../SECURITY.md) — Detailed security controls and architecture.
