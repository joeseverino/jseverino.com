# Sitedrift Brand Demo Screenshots

This directory contains the red-brand branch's visual story of the deployment
preview workflow.

## Open The Demo

- Public review URL:
  [demo-red-brand-sitedrift.jseverino.pages.dev](https://demo-red-brand-sitedrift.jseverino.pages.dev/)
- Trusted local review URL:
  [compare.homelab:4178](https://compare.homelab:4178)
- DEV is the red branch build.
- LIVE is the unchanged navy production site.

## Gallery

| Capture | File | What it proves |
|---|---|---|
| DEV in polished Solo view | `red-brand-solo.png` | A branch preview is a usable site, not a static report. |
| DEV and LIVE in Split view | `red-vs-live-split.png` | One source-of-truth color change is visible beside production. |
| Overlay in Diff mode | `red-vs-live-diff.png` | Visual drift can be isolated without manually switching tabs. |
| SEO comparison | `seo-comparison.png` | Both deployments receive metadata previews and page-level checks. |
| Response details | `response-deltas.png` | Status, response time, transfer size, and deltas are directly comparable. |
| Review notes | `browser-local-notes.png` | Feedback is useful while remaining explicitly browser-local. |

## Images

![Red-brand branch in sitedrift Solo view](./red-brand-solo.png)

![Red DEV compared with navy LIVE in Split view](./red-vs-live-split.png)

![Brand drift isolated with sitedrift Diff mode](./red-vs-live-diff.png)

![DEV and LIVE SEO comparison](./seo-comparison.png)

![Response details and deltas](./response-deltas.png)

![Browser-local review notes](./browser-local-notes.png)

Do not commit browser chrome containing account details, private tabs, local
filesystem paths, tokens, or review notes with sensitive content.
