# Technical SEO & Metadata Implementation

This document serves as a reference for the SEO strategies implemented in this Astro build. It captures the "blueprint" for maintaining high search visibility and technical performance, as detailed in the [Technical Architecture](./Architecture.md).

## 1. Structured Data (JSON-LD)
We use a centralized [`src/components/SeoHead.astro`](../src/components/SeoHead.astro) component (see [Architecture](./Architecture.md#1-architectural-overview-the-no-origin-model)) to inject Schema.org metadata:
*   **BreadcrumbList**: Dynamically generated based on the page path to improve search engine "path" visibility.
*   **Person Schema**: Identifies the author and connects social profiles (LinkedIn, GitHub) to the "Entity" Joe Severino.
*   **Article Schema**: Automatically applied to portfolio writeups with `publishedTime` and `modifiedTime`.

## 2. Heading Hierarchy
*   **Semantic H1s**: Every page (About, Contact, Resume) uses exactly one `<h1>` for the primary title.
*   **Visual Consistency**: Use the `.page-title` CSS class in [`src/styles/base.css`](../src/styles/base.css) to ensure that SEO-correct `<h1>` tags look identical to standard headings, maintaining design intent while improving crawlability.

## 3. Image Optimization Pipeline
A custom [`bin/sync-content.mjs`](../bin/sync-content.mjs) script (part of the [Vault-as-CMS Workflow](./Vault-Workflow.md)) handles assets before they reach the browser:
*   **Multi-format**: Generates **AVIF** (priority), **WebP**, and optimized fallback JPEGs/PNGs.
*   **Responsive Widths**: Resizes images to 512px, 1024px, and 1600px widths.
*   **Layout Stability**: The [`src/components/Picture.astro`](../src/components/Picture.astro) component uses the [`src/lib/image-manifest.json`](../src/lib/image-manifest.json) to include explicit `width` and `height` attributes, preventing Layout Shift (CLS) and ensuring a high Core Web Vitals score. See the [Image Pipeline](./Architecture.md#4-high-performance-image-pipeline) for details.


## 4. Security & Crawling
*   **Content Security Policy (CSP)**: Nonce-based policy (via Cloudflare Pages Functions in [`functions/_middleware.ts`](../functions/_middleware.ts)) that allows tracking (Cloudflare Analytics) and Turnstile without compromising security or SEO. See the [Security Posture](../SECURITY.md) for full details.
*   **Canonical URLs**: Every page includes a `<link rel="canonical">` to prevent duplicate content issues, especially with trailing slash variations.
*   **Identity Verification**: Social links in the footer ([`src/components/Footer.astro`](../src/components/Footer.astro)) use `rel="me"` for IndieWeb and Mastodon-style identity verification.

## 5. Automated Discovery
*   **Sitemap**: Generated via `@astrojs/sitemap` at `/sitemap-index.xml`.
*   **RSS Feed**: Available at [`src/pages/feed.xml.ts`](../src/pages/feed.xml.ts) for content syndication.
*   **Robots.txt**: Dynamically served from [`src/pages/robots.txt.ts`](../src/pages/robots.txt.ts) to point crawlers to the latest sitemap.

---

## Related Documentation
*   [Technical Architecture](./Architecture.md) — Internal engine and performance details.
*   [Vault-as-CMS Workflow](./Vault-Workflow.md) — How content moves from Obsidian to the site.
*   [Authoring Guide](./Authoring-Guide.md) — Manual for custom Markdown directives.
*   [Security Posture](../SECURITY.md) — Detailed security architecture and controls.
