# Branding-Engine And Sitedrift Case Study

These images document a temporary red-brand experiment. `branding-engine`
generated the coordinated brand change from one source-of-truth edit, while
`sitedrift` compared the resulting branch preview with the unchanged navy
production site.

The full explanation appears in
[Deployment Preview Review](../../Deployment-Preview-Review.md).

## What Each Capture Shows

- `github-brand-token-og-diff.png`: the palette changes once in
  `src/lib/brand.ts`, and branding-engine regenerates the Open Graph card.
- `github-generated-assets-diff.png`: the same token change propagates through
  the GitHub social preview and transparent mark.
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
