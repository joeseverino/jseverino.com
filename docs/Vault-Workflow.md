# Vault-as-CMS Workflow

This site uses a [Vault-as-CMS architecture](./Architecture.md). The private **Severino Labs** Obsidian vault is the canonical source of truth for all content, while this repository serves as the public build and deployment target.

## 1. Stack Topology

```text
Severino Labs vault (Private)
  ├── 06 Pages/           # Page markdown & site-wide data
  └── 05 Writeups/        # Portfolio writeups & project images
      │
      │ site sync (bin/sync-content.mjs)
      v
jseverino.com repo (Public Snapshot)
  ├── src/content/        # Sanitized markdown snapshots
  └── public/assets/      # Optimized public assets
      │
      │ Cloudflare Pages Build
      v
Live Site (jseverino.com)
```

## 2. Content Organization (Vault)

### Portfolio Writeups
Located in `05 Writeups/<slug>/`. The folder name determines the URL slug.
*   `index.md`: The main content, using [custom directives](./Authoring-Guide.md) rendered via [`src/lib/content.ts`](../src/lib/content.ts).
*   `images/`: Local assets referenced by the writeup.
*   `source/`: (Optional) Private working materials; ignored by the sync script.

### Site Pages
Located in `06 Pages/<slug>/`.
*   `index.md`: Page content (About, Contact, Resume, etc.).
*   `_site.md`: Global site name and navigation links, synced to [`src/content/site.md`](../src/content/site.md).
*   `_technology-groups.md`: Single source of truth for the [technology taxonomy](./Architecture.md#6-technology-taxonomy), synced to [`src/content/technology-groups.md`](../src/content/technology-groups.md).

## 3. The Sync Contract

The [`bin/sync-content.mjs`](../bin/sync-content.mjs) script enforces a strict [security boundary](../SECURITY.md) between private notes and public site.

### The Publish Gate
Content only reaches this repository if its frontmatter includes:
```yaml
published: true
```
If `published` is `false` or missing, the content is treated as a draft and is never copied to the site repo.

### Metadata Stripping
To maintain privacy, the sync script strips vault-only metadata from the frontmatter. Fields like `doc_id`, `system`, `related_projects`, and `sensitivity` stay in the private vault and never reach the public repo. This process is detailed in the [Content Sync Engine](./Architecture.md#2-the-content-sync-engine).


## 4. Tooling & CLI

The site is managed via a custom `site` CLI toolchain (part of the `joeseverino/tools` repository).

| Command | Action |
| --- | --- |
| `site new-writeup <slug>` | Scaffolds a new writeup folder in the vault with draft frontmatter. |
| `site sync` | Runs [`bin/sync-content.mjs`](../bin/sync-content.mjs) to pull `published` content into the local repo. |
| `site dev` | Starts the Astro dev server for local preview. |
| `site dev --drafts` | Syncs all content (including drafts) for local-only preview. |
| `site publish` | Performs a full audit: clean, sync, check, and build. |
| `site publish-all` | The "one command" to sync, build, commit the snapshot, and push to GitHub. Runs [`bin/publish-check.mjs`](../bin/publish-check.mjs). |

## 5. Security Boundaries

*   **No Origin**: The site is 100% static (SSG). There is no database or admin panel to harden. See the [Security Posture](../SECURITY.md) for full architecture details.
*   **Build Independence**: Cloudflare Pages builds from the committed snapshot in this repo. It has zero access to the private vault.
*   **Auditability**: Because the synced content is committed to Git, the public surface is fully auditable in the repository history.

---

## Related Documentation
*   [Authoring Guide](./Authoring-Guide.md) — Reference for custom components used in the vault.
*   [Technical Architecture](./Architecture.md) — Deep dive into the sync engine and image pipeline.
*   [Technical SEO & Metadata](./SEO.md) — How synced content is optimized for search.
