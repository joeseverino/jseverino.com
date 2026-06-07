# Branding-Engine And Sitedrift Case Study

These images document a temporary red-brand experiment. `branding-engine`
generated the coordinated brand change from one source-of-truth edit, while
`sitedrift` compared the resulting Cloudflare preview with the unchanged navy
production site.

The full explanation appears in
[Deployment Preview Review](../../Deployment-Preview-Review.md). The exact
historical deployment remains available at
[`30d9262b.jseverino.pages.dev`](https://30d9262b.jseverino.pages.dev/).

## What Each Capture Shows

- `red-brand-solo.png`: the generated branch remains a fully interactive site.
- `red-vs-live-split.png`: all brand surfaces change together while layout and
  content remain aligned.
- `red-vs-live-diff.png`: identical pixels disappear, isolating the brand-only
  visual change.
- `seo-comparison.png`: metadata and page-level SEO remain healthy on both
  deployments.
- `response-deltas.png`: HTTP status, response timing, transfer size, and
  differences are visible together.
- `browser-local-notes.png`: review context is useful without adding a public
  write API or account system.
