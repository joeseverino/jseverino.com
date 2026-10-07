# Dist Branch

The `dist` branch holds the HTML, CSS, scripts, and images the site is built into,
one commit per deploy that changed them. It makes the served site readable in the
repository: `git log -p dist` shows what each deploy changed in the rendered pages.
The branch is generated; nothing is edited on it.

## How it is published

| Piece | Does |
|---|---|
| [`dist.yml`](../.github/workflows/dist.yml) | On each push to `main`, runs `npm run build` (the command Cloudflare Pages runs) and publishes the output |
| [`bin/publish-dist.ts`](../bin/publish-dist.ts) | Builds a git tree from the output directory with a temporary index and commits it on top of `origin/dist`; no commit when the tree is unchanged |
| `PUBLIC_TURNSTILE_SITE_KEY` | The one build-time variable the pages need. Cloudflare Pages holds it as a project variable; the workflow reads it from a repository variable declared in [`github/repo.json`](../github/repo.json) |

The publish job is the only one with `contents: write`, and it runs only for pushes
to `main`, so pull-request code never holds the write token. The commit is created
through the GitHub API, which signs it for the Actions token, so every `dist` commit
shows Verified. The built tree goes up first under a hidden ref
(`refs/dist-staging/<sha>`, not a branch, so nothing builds it) and is deleted once
`dist` moves.

Cloudflare Pages must not build `dist`: it holds output, not source. `pages.previewBranches`
in [`cloudflare/zone.json`](../cloudflare/zone.json) excludes it from preview deployments
(see [Cloudflare](./Cloudflare.md)).

## Verification

`npm run deploy:verify` fetches `dist` and compares every sitemap page with what the
live site serves, byte for byte. The publish runs a few minutes after the deploy, so a
mismatch is retried for six minutes before it fails. A difference that persists means
the two builds disagree, or the edge rewrote the page. The check also fails if the
tip of `dist` is not a verified commit.

| Command | Does |
|---|---|
| `npm run dist:publish` | Commit a build directory to `dist` locally; with `-- --push`, push it (CI does this) |
