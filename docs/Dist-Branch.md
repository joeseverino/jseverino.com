# Dist Branch

The `dist` branch holds the HTML, CSS, scripts, and images production serves, one
commit per deploy that changed them, so anyone can browse the site's served
source on GitHub without building it. `git log -p dist` shows what each deploy
changed in the rendered pages. The branch is generated; nothing is edited on it.

## How it is published

| Piece | Does |
|---|---|
| [`deploy`](../.github/workflows/deploy.yml) job `dist` | After a production deploy and its attestation, unpacks the attested archive of `dist/client/` (the bytes the Worker now serves) and publishes it. Nothing is rebuilt |
| [`bin/publish-dist.ts`](../bin/publish-dist.ts) | Builds a git tree from the output directory with a temporary index and commits it on top of `origin/dist`; no commit when the tree is unchanged |

The `dist` job is the only one with `contents: write`, holds no Cloudflare secret,
and runs only after `main`'s tip deploys, so pull-request code never holds the write
token. The commit is created through the GitHub API, which signs it for the Actions
token, so every `dist` commit shows Verified. The built tree goes up first under a
hidden ref (`refs/dist-staging/<sha>`, not a branch) and is deleted once `dist`
moves. The `deploy` workflow starts only from a `ci` run, and `ci` runs only on
`main` and pull requests into it, so a push to `dist` deploys nothing.

## Verification

`mise run deploy:verify` fetches `dist` and compares every sitemap page with what the
live site serves, byte for byte. The publish runs a few minutes after the deploy, so a
mismatch is retried for six minutes before it fails. A difference that persists means
the edge rewrote the page, or `dist` is behind the deploy. The check also fails if the
tip of `dist` is not a verified commit.

| Command | Does |
|---|---|
| `mise run publish:dist` | Commit a build directory to `dist` locally; with `--push`, push it (CI does this) |
