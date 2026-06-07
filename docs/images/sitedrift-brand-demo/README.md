# Sitedrift Brand Demo Screenshots

Use the red-brand branch to capture a concise visual story of the deployment
preview workflow.

## Open The Demo

- Public review URL:
  [demo-red-brand-sitedrift.jseverino.pages.dev](https://demo-red-brand-sitedrift.jseverino.pages.dev/)
- Trusted local review URL:
  [compare.homelab:4178](https://compare.homelab:4178)
- DEV is the red branch build.
- LIVE is the unchanged navy production site.

## Capture Set

| Capture | Save as | What it proves |
|---|---|---|
| DEV in polished Solo view | `red-brand-solo.png` | A branch preview is a usable site, not a static report. |
| DEV and LIVE in Split view | `red-vs-live-split.png` | One source-of-truth color change is visible beside production. |
| Overlay in Diff mode | `red-vs-live-diff.png` | Visual drift can be isolated without manually switching tabs. |
| Status details and SEO panel | `seo-and-response.png` | The review includes response timing, metadata, and SEO checks. |

Capture desktop screenshots at a consistent browser size. For the Split and
Diff images, keep both panes on `/` at the same scroll position. For the final
image, show the status detail popover or SEO panel with both DEV and LIVE
results visible.

## Ready-To-Embed Markdown

After placing the images in this directory, use:

```md
![Red-brand branch in sitedrift Solo view](./docs/images/sitedrift-brand-demo/red-brand-solo.png)

![Red DEV compared with navy LIVE in Split view](./docs/images/sitedrift-brand-demo/red-vs-live-split.png)

![Brand drift isolated with sitedrift Diff mode](./docs/images/sitedrift-brand-demo/red-vs-live-diff.png)

![Response details and SEO comparison](./docs/images/sitedrift-brand-demo/seo-and-response.png)
```

Do not commit browser chrome containing account details, private tabs, local
filesystem paths, tokens, or review notes with sensitive content.
