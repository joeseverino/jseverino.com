# Technical SEO & Metadata Implementation

This document serves as a reference for the SEO strategies implemented in this Astro build. It captures the "blueprint" for maintaining high search visibility and technical performance.

## 1. Structured Data (JSON-LD)
We use a centralized `SeoHead.astro` component to inject Schema.org metadata:
*   **BreadcrumbList**: Dynamically generated based on the page path to improve search engine "path" visibility.
*   **Person Schema**: Identifies the author and connects social profiles (LinkedIn, GitHub) to the "Entity" Joe Severino.
*   **Article Schema**: Automatically applied to portfolio writeups with `publishedTime` and `modifiedTime`.

## 2. Heading Hierarchy
*   **Semantic H1s**: Every page (About, Contact, Resume) uses exactly one `<h1>` for the primary title.
*   **Visual Consistency**: Use the `.page-title` CSS class to ensure that SEO-correct `<h1>` tags look identical to standard headings, maintaining design intent while improving crawlability.

## 3. Image Optimization Pipeline
A custom `sync-content.mjs` script handles assets before they reach the browser:
*   **Multi-format**: Generates **AVIF** (priority), **WebP**, and optimized fallback JPEGs/PNGs.
*   **Responsive Widths**: Resizes images to 512px, 1024px, and 1600px widths.
*   **Layout Stability**: The `Picture.astro` component uses the `image-manifest.json` to include explicit `width` and `height` attributes, preventing Layout Shift (CLS) and ensuring a high Core Web Vitals score.

## 4. Security & Crawling
*   **Content Security Policy (CSP)**: Nonce-based policy (via Cloudflare Pages Functions) that allows tracking (Cloudflare Analytics) and Turnstile without compromising security or SEO.
*   **Canonical URLs**: Every page includes a `<link rel="canonical">` to prevent duplicate content issues, especially with trailing slash variations.
*   **Identity Verification**: Social links in the footer use `rel="me"` for IndieWeb and Mastodon-style identity verification.

## 5. Automated Discovery
*   **Sitemap**: Generated via `@astrojs/sitemap` at `/sitemap-index.xml`.
*   **RSS Feed**: Available at `/feed.xml` for content syndication.
*   **Robots.txt**: Dynamically served to point crawlers to the latest sitemap.

---

## Related Documentation
*   [Technical Architecture](./Architecture.md) — Internal engine and performance details.
*   [Vault-as-CMS Workflow](./Vault-Workflow.md) — How content moves from Obsidian to the site.
*   [Authoring Guide](./Authoring-Guide.md) — Manual for custom Markdown directives.
*   [Security Posture](../SECURITY.md) — Detailed security architecture and controls.
