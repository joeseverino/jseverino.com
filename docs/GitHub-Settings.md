# GitHub Settings

The repository's merge rules, security features, Actions permissions, and the
`main` ruleset are declared in [`.github/repo.json`](../.github/repo.json) and
checked against the live repository by `bin/github.ts`. The file is validated by
[`.github/repo.schema.json`](../.github/repo.schema.json) and holds no tokens; the
only ids in it are the public app ids of two required status checks. The
Cloudflare side of the same pattern is in [Cloudflare](./Cloudflare.md).

## What is declared

| Section | Declares |
|---|---|
| `settings` | Squash as the only merge method (rebase merging strips SSH commit signatures), auto-merge on for Dependabot, branches deleted on merge, the squash commit title and message, no wiki |
| `security` | Secret scanning and push protection, Dependabot security updates and alerts, private vulnerability reporting |
| `actions` | Every `uses:` reference pinned to a commit SHA, a read-only default workflow token, and no workflow approving pull requests |
| `variables` | Actions variables, by name: the public Turnstile site key the [dist workflow](./Dist-Branch.md) builds with. Variables not listed are left alone |
| `ruleset` | The `main` branch ruleset, compared as a whole: pull request required with squash only, the required status checks, no force pushes, no deletion, signed commits required |

The ruleset names the repository admin role as a bypass actor, which is how the
live ruleset is configured. The rule that nothing is pushed to `main` directly
is kept by convention (see [Development](./Development.md)), not by the ruleset.

A new CI job that must gate merges is added to the ruleset's
`required_status_checks` in `.github/repo.json`, then applied.

## Running check, plan, and apply

| Command | Does |
|---|---|
| `npm run github:check` | Read the live repository, print a table (`-- --json` for JSON), exit 1 on drift |
| `npm run github:plan` | List the API calls an apply would make |
| `npm run github:apply` | Print the plan; with `-- --yes`, make the calls, then re-check |

The token comes from `GITHUB_TOKEN`, then `GH_TOKEN`, then `gh auth token`, and
is never printed. It needs repository Administration: read for `check` and
`plan`, write for `apply`; a classic token with the `repo` scope covers both.

Apply changes only what `.github/repo.json` declares. The ruleset is replaced as
a whole, matched by name; no other ruleset is touched. Unit tests drive all
three commands against an in-memory API
([`tests/unit/github.test.ts`](../tests/unit/github.test.ts)); nothing in the
repo calls GitHub on its own.
