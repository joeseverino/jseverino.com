# GitHub settings

The repository's merge rules, security features, Actions permissions, and the
`main` and `dist` rulesets are declared in [`.github/repo.json`](../.github/repo.json) and
checked against the live repository by `bin/github.ts`. The file is validated by
[`.github/repo.schema.json`](../.github/repo.schema.json) and holds no tokens; the
only id in it is GitHub Actions' public app id (`15368`), which pins the required
`deploy` check to the check-run the deploy workflows open, so no other app can
satisfy it, and is the one actor that may move `dist`. The Cloudflare side of the same pattern is in [Cloudflare](./Cloudflare.md).

## What is declared

| Section | Declares |
|---|---|
| `settings` | Squash as the only merge method (rebase merging strips SSH commit signatures), auto-merge off (nothing merges on its own), branches deleted on merge, the squash commit title and message, no wiki, and the About description, homepage and topics (the description makes claims about the site, so it is held to the file) |
| `security` | Secret scanning and push protection, vulnerability alerts on with Dependabot security updates off (Renovate reads the alerts and opens the fixes, see [Dependencies](./Dependencies.md#advisories)), private vulnerability reporting, immutable releases (a published release's files and tag are locked, and GitHub attests the release; `release.yml` publishes each one with its files attached), and CodeQL default setup for `actions` and `javascript-typescript` |
| `actions` | Every `uses:` reference pinned to a commit SHA, a read-only default workflow token, and no workflow approving pull requests |
| `variables` | Actions variables, by name: the public Turnstile site key the `ci` workflow's `build` job builds with. Variables not listed are left alone |
| `rulesets` | Each branch ruleset, matched by name and compared as a whole. `main`: pull request required with squash only, the required status checks, CodeQL results with no error or high-severity alert, no force pushes, no deletion, signed commits required. `dist`: no update, force push or deletion, with GitHub Actions as the one bypass actor |

The `main` ruleset has no bypass actors: every change to `main`, the owner's
included, goes through a pull request with the required checks green. The
`dist` ruleset lets only GitHub Actions move the branch, so only the deploy
workflow's `dist` job, whose commits GitHub signs, changes what it holds
([Dist branch](./Dist-Branch.md)).

CodeQL default setup and the ruleset's `code_scanning` rule change in the same
apply, default setup first: a rule or required check waiting on an analysis
that never runs blocks every pull request. Apply enables default setup with
`PATCH .../code-scanning/default-setup`, which queues the first analysis.

A new CI job that must gate merges is added to the ruleset's
`required_status_checks` in `.github/repo.json`, then applied.

## Running check, plan, and apply

| Command | Does |
|---|---|
| `mise run github check` | Read the live repository, print a table (`--json` for JSON), exit 1 on drift |
| `mise run github plan` | List the API calls an apply would make |
| `mise run github apply` | Print the plan; with `--yes`, make the calls, then re-check |

The token comes from `GITHUB_TOKEN`, then `GH_TOKEN`, then `gh auth token`, and
is never printed. It needs repository Administration: read for `check` and
`plan`, write for `apply`; a classic token with the `repo` scope covers both.

Apply changes only what `.github/repo.json` declares. Each ruleset is replaced
as a whole, matched by name, and one not declared is never touched. Unit tests drive all
three commands against an in-memory API
([`tests/unit/github.test.ts`](../tests/unit/github.test.ts)); nothing in the
repo calls GitHub on its own.
