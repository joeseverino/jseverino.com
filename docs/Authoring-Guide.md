# Content Authoring & Component Reference

This site uses a custom Markdown extension layer. Content is authored in a private vault using standard Markdown plus a set of `::` directives that the Astro engine transforms into optimized, responsive components as part of the [Vault-as-CMS Workflow](./Vault-Workflow.md). The transformation logic is implemented in [`src/lib/content.ts`](../src/lib/content.ts).

## 1. Custom Image Syntax
We extend standard Markdown images with pipe-separated options to control layout and captions. These are processed by the [High-Performance Image Pipeline](./Architecture.md#3-high-performance-image-pipeline) and rendered via [`src/components/Picture.astro`](../src/components/Picture.astro).

*   **Standard**: `![Caption](./images/x.png)`  
    The alt text becomes the visible figure caption automatically.
*   **Width Override**: `![Caption|480](./images/x.png)`  
    Constrains the display width of the image (in this case to 480px).
*   **No Caption**: `![Alt Text|nocap](./images/x.png)`  
    Renders a plain image without the `<figure>` wrapper or visible caption.

## 2. Global Directives
These blocks work across both top-level pages and portfolio writeups.

### Terminal Block
Renders a simulated macOS-style terminal window with traffic-light controls.
```md
::terminal
$ site publish-all
Building static entrypoints...
✓ Completed in 1.46s.
::
```
*   Lines starting with `$` are rendered as commands with a prompt.
*   Other lines are rendered as standard output.

### Buttons & Actions
*   **Single Button**: `::button [Label](/path/) ::`
*   **Sticky Button**: `::button sticky [Label](/path/) ::` (Pinned to the bottom of the viewport; used for resumes/downloads).
*   **Button Row**:
    ```md
    ::buttons
    - [Primary Action](/path1/)
    - [Secondary Action](/path2/)
    ::
    ```
*   **Call-to-Action (CTA)**: `::cta ::` (Injects a standard button row for Portfolio/Contact).

### Centered Content
Renders content with center-alignment.
```md
::center
Text or Markdown to be centered.
::
```

## 3. Page-Specific Directives
Used primarily for structured layouts in `src/content/pages/`.

### Split Layout (2-Column)
Uses `::::: as a separator to create a responsive two-column grid.
```md
::split
Left column content (Markdown, images, etc.).
:::
Right column content.
::
```

### Dynamic Content Injection
*   **`::featured-projects ::`**: Injects the responsive grid of projects marked `featured: true` in their frontmatter, using [`src/components/ProjectCard.astro`](../src/components/ProjectCard.astro).
*   **`::technology-cloud ::`**: Injects the categorized tag cloud sourced from [`src/content/technology-groups.md`](../src/content/technology-groups.md) (see [Technology Taxonomy](./Architecture.md#6-technology-taxonomy)) via [`src/components/TechnologyCloud.astro`](../src/components/TechnologyCloud.astro).
*   **`::cta ::`**: Injects a standard Call-to-Action block with links to the Portfolio and Contact pages.

## 4. Writeup-Specific Directives
Used primarily in `src/content/writeups/` to handle complex technical documentation.

### Figures & Tables
Standard Markdown works, but these directives allow for multi-line captions and specialized styling, which supports our [Technical SEO](./SEO.md) goals:
```md
::figure
![Alt](./images/diagram.png)
Detailed caption with **Markdown** and [links](/) support.
::

::table
| Feature | Status |
|---------|--------|
| CSP     | Strict |
Table caption providing context for the data above.
::
```
*Note: Writeup tables are automatically rendered with a "striped" style in [`src/styles/base.css`](../src/styles/base.css), as defined in the [Transformation Layer](./Architecture.md#3-the-transformation-layer).*


---

## Related Documentation
*   [Vault-as-CMS Workflow](./Vault-Workflow.md) — The sync process and content gates.
*   [Technical Architecture](./Architecture.md) — How the engine transforms these directives.
*   [Technical SEO & Metadata](./SEO.md) — How content impacts search visibility.
*
