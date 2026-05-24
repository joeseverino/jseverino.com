# jseverino.com (v2.0.0)

The high-performance, security-hardened personal site of Joe Severino. Built with **Astro 6**, delivered via **Cloudflare Pages**, and authored entirely from a private **Obsidian** vault.

```text
Severino Labs vault  ─►  jseverino.com repo  ─►  Cloudflare Pages
(Private SOT)            (Sanitized Snapshot)    (Edge Delivery)
```

This repository implements a **"Vault-as-CMS"** architecture, where a private notes vault serves as the canonical source of truth for all content, identity, and metadata.

## 💎 Technical Excellence (The Diamond Standard)

The site is engineered for maximum performance, operational discipline, and security:

*   **Asynchronous Content Engine**: The sync pipeline ([`bin/sync-content.mjs`](./bin/sync-content.mjs)) uses non-blocking `fs.promises` and Sharp for high-speed content transformation and image optimization.
*   **Zero Cumulative Layout Shift (CLS)**: Every image is processed into a responsive matrix (AVIF/WebP) with intrinsic dimensions tracked in a [manifest](./src/lib/image-manifest.json) to ensure perfect layout stability.
*   **Automated Metadata Hashing**: The system automatically tracks "Last Reviewed" dates by hashing content during sync, eliminating manual date management.
*   **Nonce-based CSP**: A strict, edge-enforced Content Security Policy ([`functions/_middleware.ts`](./functions/_middleware.ts)) prevents XSS without compromising first-party functionality.
*   **Single Source of Truth**: All site identity, professional skills, and navigation are managed from a single Markdown file in the vault, synced directly to the repo ([`src/content/site.md`](./src/content/site.md)).

## 🚀 Workflow

Management is handled via a [personal CLI suite](https://github.com/joeseverino/tools):

```sh
site sync          # Pull published content & identity from vault
site publish       # Full audit: clean + sync + check + build + image weight audit
site publish-all   # Orchestrated path: hq sync, publish, commit, push to edge
```

Equivalent local commands:
*   `npm run sync:content` — Runs [`bin/sync-content.mjs`](./bin/sync-content.mjs).
*   `npm run publish:check` — Runs [`bin/publish-check.mjs`](./bin/publish-check.mjs) (integrity guard).

## 🏗️ Architecture & Documentation

The site's internals are fully documented for both engineering showcase and operational clarity:

*   [**Technical Architecture**](./docs/Architecture.md) — Deep dive into the transformation engine ([`src/lib/content.ts`](./src/lib/content.ts)), image pipeline, and security model.
*   [**Vault-as-CMS Workflow**](./docs/Vault-Workflow.md) — How the private/public boundary is enforced.
*   [**Authoring Guide**](./docs/Authoring-Guide.md) — Manual for custom Markdown directives (`::terminal`, `::split`, `::cta`, etc.).
*   [**Technical SEO**](./docs/SEO.md) — Blueprint for search visibility and Person Schema ([`src/components/SeoHead.astro`](./src/components/SeoHead.astro)).
*   [**Security Posture**](./SECURITY.md) — Master threat model and edge security controls ([`public/_headers`](./public/_headers)).

## 📦 Repo Boundaries

**Committed:**
- [`src/`](./src/) — Astro source & transformation logic.
- [`public/`](./public/) — Static assets & Cloudflare [`_headers`](./public/_headers).
- [`src/content/`](./src/content/) — Sanitized public content snapshots.
- [`src/lib/image-manifest.json`](./src/lib/image-manifest.json) — Intrinsic dimension database.
- [`docs/`](./docs/) — Comprehensive technical documentation suite.

**Not Committed:**
- `.astro/`, `dist.nosync/`, `node_modules/` — Build and dependency artifacts.
- `.env*`, `.dev.vars` — Local environment secrets.
- iCloud conflict copies (`* 2.*`, etc.) are automatically resolved by [`bin/clean-generated.mjs`](./bin/clean-generated.mjs).

## 📜 History
This site transitioned from WordPress to a static Astro build in early 2026 to collapse the source of truth into local Markdown files and eliminate the "origin" attack surface. The legacy WordPress mirror is preserved at [`joeseverino/jseverino.com-legacy`](https://github.com/joeseverino/jseverino.com-legacy).
