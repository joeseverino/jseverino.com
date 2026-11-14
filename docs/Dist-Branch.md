# Dist branch

The `dist` branch holds the HTML, CSS, scripts, and images production serves, one
commit per deploy that changed them, so anyone can browse the site's served
source on GitHub without building it. `git log -p dist` shows what each deploy
changed in the rendered pages. The branch is generated; nothing is edited on it.
Its [README](https://github.com/joeseverino/jseverino.com/tree/dist), written
by `README` in [`bin/lib/dist.ts`](../bin/lib/dist.ts), names the trailers each
commit carries as its proof and how to verify a deploy against its attestation.

## How it is published

After a production deploy and its attestation, the
[`deploy`](../.github/workflows/deploy.yml) workflow's `dist` job checks the
attested archive of `dist/client/` (the bytes the Worker serves) against the
digest the `attest` job signed, unpacks it, and publishes it; nothing is
rebuilt. [`bin/publish-dist.ts`](../bin/publish-dist.ts) builds a git tree from
that directory with a temporary index, adds the branch's README to that index
alone, and commits it on top of `origin/dist`, with no commit when the tree is
unchanged. The README's text is the same on every deploy, so it never makes a
commit of its own, and it is never in the site directory, so no host serves it.
`mise run publish:dist` runs the same script locally, and `--push` pushes the
commit.

The `dist` job is the only one with `contents: write`, holds no Cloudflare secret,
and runs only after `main`'s tip deploys, so pull-request code never holds the write
token. The commit is created through the GitHub API, which signs it for the Actions
token, so every `dist` commit shows Verified. The `dist` ruleset in
[`.github/repo.json`](../.github/repo.json) refuses any update, force push or
deletion except GitHub Actions', so nothing else moves the branch. The built tree goes up first under a
hidden ref (`refs/dist-staging/<sha>`, not a branch) and is deleted once `dist`
moves. The `deploy` workflow starts only from a `ci` run, and `ci` runs only on
`main` and pull requests into it, so a push to `dist` deploys nothing.

## Verification

`mise run deploy:verify` fetches `dist` and compares every sitemap page with what the
live site serves, byte for byte. The publish runs a few minutes after the deploy, so a
mismatch is retried for six minutes before it fails. A difference that persists means
the edge rewrote the page, or `dist` is behind the deploy. The check also fails if the
tip of `dist` is not a verified commit.
