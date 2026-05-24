# Technical Architecture: jseverino.com

This document serves as the master technical reference for the engineering, security, and performance architecture of [jseverino.com](../). It describes a custom-built content delivery system optimized for a "Vault-as-CMS" workflow.

## 1. The Core Philosophy: Security by Construction
The site is built on a "No Origin" model, meaning there is no application server or database reachable by the public. Whole classes of web vulnerabilities (SQLi, RCE, Auth Bypass) are eliminated by the static nature of the build.

*   **SSG Architecture**: Built with [Astro](../astro.config.mjs) (Static Site Generation).
*   **Zero JS Runtime**: The site ships near-zero client-side JavaScript, ensuring high security and performance.
*   **Isolation**: The build environment (Cloudflare Pages) has zero access to the private vault; it builds from a sanitized public snapshot.

## 2. The Transformation Engine ([`src/lib/content.ts`](../src/lib/content.ts))
Rather than using standard Markdown rendering, the site uses a multi-pass transformation engine built on `markdown-it`.

### Custom Directives (`::`)
A set of regex-driven passes transforms Obsidian-style directives into semantic HTML:
*   **Terminal Simulation**: `renderTerminal()` transforms `::terminal` blocks into macOS-style windows with traffic-light controls and simulated prompts.
*   **Responsive Layouts**: `renderSplit()` implements a two-column grid system using `::split` and `:::` separators.
*   **Dynamic Injection**: `preprocessPageMarkdown()` detects placeholders like `::featured-projects::` and replaces them with data-bound Astro components.

### Table & Figure Enhancements
Custom rules extend the base renderer:
*   **Striped Tables**: The `table_open` rule is overridden to wrap every Markdown table in a `<figure class="table-figure table-figure--striped">`, ensuring consistent styling and mobile horizontal scrolling.
*   **Auto-Captions**: `preprocessImageDirectives()` and `restoreFigures()` work together to promote standard Markdown images to `<figure>` elements if alt text is provided, while supporting pipe-separated overrides like `![alt|nocap]`.

## 3. High-Performance Image Pipeline
Images are processed via a custom Sharp-powered pipeline in [`bin/sync-content.mjs`](../bin/sync-content.mjs) to achieve a perfect 100 Performance score.

### Multi-Format Generation
Every source image is converted into a tiered matrix of variants:
1.  **AVIF**: Primary modern format (high compression, high quality).
2.  **WebP**: Secondary modern format for broader compatibility.
3.  **Raster Fallback**: Optimized JPEG/PNG at the original path for legacy support.

### Zero Layout Shift (CLS)
One of the most critical features is the automated dimension tracking:
*   **The Manifest**: [`src/lib/image-manifest.json`](../src/lib/image-manifest.json) stores the intrinsic width and height of every asset generated during sync.
*   **The Component**: [`src/components/Picture.astro`](../src/components/Picture.astro) looks up these dimensions at build-time. It sets explicit `width` and `height` attributes on the `<img>` tag, allowing the browser to reserve space before the pixel data arrives.

## 4. Security Infrastructure
### Nonce-based CSP ([`functions/_middleware.ts`](../functions/_middleware.ts))
The site uses a strict Content Security Policy (CSP) without compromising the utility of first-party inline scripts:
1.  **Middleware**: On every request, a unique cryptographic nonce is generated.
2.  **Injection**: `HTMLRewriter` scans the document and attaches the nonce to every `<script>` tag.
3.  **Enforcement**: The `Content-Security-Policy` header is emitted with the matching nonce, blocking all unauthorized third-party scripts and XSS attempts.

### Contact Integrity
The contact form ([`src/components/ContactForm.astro`](../src/components/ContactForm.astro)) is backed by a Cloudflare Pages Function ([`functions/api/contact.ts`](../functions/api/contact.ts)) that implements:
*   **Cloudflare Turnstile**: Automated bot challenge verification.
*   **Rate Limiting**: IP-based throttling via Cloudflare D1.
*   **Honeypot**: Hidden fields to catch unsophisticated bot spam.

## 5. Local Toolchain & Workflow
The site is supported by a specialized CLI (part of the [`joeseverino/tools`](https://github.com/joeseverino/tools) repo) that coordinates the [Vault-as-CMS Workflow](./Vault-Workflow.md):

*   [`bin/clean-generated.mjs`](../bin/clean-generated.mjs): Resolves iCloud-specific conflict copies ("home 2.md") by comparing mtimes and content freshness.
*   [`bin/publish-check.mjs`](../bin/publish-check.mjs): The "Stale Hash Guard." It fails the build if the inline script hashes in [`public/_headers`](../public/_headers) don't match the actual build output.

---

## Related Documentation
*   [Vault-as-CMS Workflow](./Vault-Workflow.md) — The sync lifecycle and content gates.
*   [Authoring Guide](./Authoring-Guide.md) — Manual for using the custom transformation directives.
*   [Technical SEO & Metadata](./SEO.md) — Deep dive into search and social visibility.
*   [Security Posture](../SECURITY.md) — Detailed threat model and security architecture.
