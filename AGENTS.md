# jseverino.com engineering contract

The rules for changing this repository. Setup, tasks and layout are in
[Development](docs/Development.md).

## Design rules

- Use what Astro, Cloudflare, Node, Playwright, mise and GitHub provide at the
  pinned version before writing code. Custom code needs a job the stack does
  not already do.
- When a job moves onto a tool, check that tool's docs at the pinned version
  and remove the custom code its features replace.
- Every fact has one source, and everything else derives from it: the
  contracts under `contracts/`, the brand tokens, `src/lib/site-config.ts`,
  the mise tasks. A second copy is generated from the first and checked by
  `mise run checks:contracts`, never written by hand.
- Fix a defect everywhere it occurs, and add the gate or test that catches it
  next time.

## Start here

1. `mise install` pins every tool; the first `mise run` installs the npm
   dependencies from the lockfile, and every later one reinstalls them when
   the lockfile moves. `mise doctor project` says whether the checkout is ready.
2. Branch from the latest `main`: `git fetch origin && git switch -c <type>/<slug> origin/main`.
3. While editing, run `mise run fast`. Before committing, run `mise run check`
   (static gates, the production build, then every gate on the build). CI runs
   the same tasks plus `mise run browser`.

Every gate is a mise task; `mise tasks` lists them and
[Commands](docs/Commands.md) has the table. A failing gate prints its own fix.
A single gate (`mise run built:weight`) is for iterating on a failure.

## Boundaries

- `src/content/` and `public/assets/` are synced snapshots of a private vault.
  Never edit them by hand; `mise run sync:content` rewrites them. A sync that
  changes a file no one edited can mean the vault is behind the repository:
  read that file's `git log` before committing the change.
- Generated files are written by their sync script and checked by
  `mise run checks:contracts`: the token block in `src/styles/tokens.css`
  (`mise run sync:tokens`), and `src/generated/content-schema.ts`.
  `src/generated/worker-configuration.d.ts` is gitignored and written from
  `wrangler.jsonc` by `mise run sync:worker-types`, which every task that
  type-checks depends on. The task list in `docs/Commands.md` is written by
  `mise generate task-docs --inject --output docs/Commands.md` and checked by
  `mise run checks:docs-sync`.
- `main` is production: once `ci` passes on its tip, the `deploy` workflow
  ships that build as the `jseverino` Worker. Every change rides a
  branch and a pull request, squash-merged, never rebase-merged (that strips
  commit signatures).
- An agent opens the pull request and shows its preview, then merges only on
  the owner's go. Nothing merges on its own, content included.
- Never delete `package-lock.json` to add a dependency: a lock regenerated on
  macOS drops the Linux platform binaries
  ([npm/cli#4828](https://github.com/npm/cli/issues/4828)).
- A change to the `site` CLI keeps every command's `--json` result and its
  non-interactive behavior ([Site CLI](docs/Site-CLI.md#built-for-an-agent-caller)).

## Styling and client code

- `src/styles/base.css` is the only stylesheet entry point and declares the
  layer order (`@layer tokens, base, components`). Modules under `src/styles/`
  are imported from it exactly once; no component-scoped `<style>` blocks.
- Every color is a named token. No literal colors in rules.
- Client JavaScript is a bundled component `<script>`, never `is:inline`,
  so Astro emits an external, minified module. One delegated listener
  (`closest()`) over per-element handlers. Every page works with JavaScript
  disabled. No View Transitions.
- Budgets are hard gates (`mise run built:weight`): HTML at most 150 KB per
  page, CSS 75 KB, JavaScript 25 KB in total.
- Markdown images take `|width`, `|nocap` and `|nozoom` modifiers
  (`src/lib/markdown/`); a new modifier is documented in
  [the Authoring Guide](docs/Authoring-Guide.md).
- The footer holds View Source, the theme control and the social icons. No
  privacy, copyright or sitemap links.

## Visual baselines

Settle a visual change by reasoning about the CSS first, batch the changes,
then verify once in the browser.

Baselines under `tests/playwright/visual.spec.ts-snapshots/` are macOS
Chromium renders and viewport-only. After an intentional layout change, run
`mise run browser:visual --update-snapshots --project=chromium-desktop` on
macOS, inspect the diffs, and commit the new PNGs with the change. A change
below the fold moves no baseline; `git status` shows what did.

## Commits and docs

- Conventional Commits. Public docs ship in the same commit as the code they
  describe.
- Docs live at `docs/<Title-Case-Hyphenated>.md`, in a neutral or imperative
  voice with no "you" or "the operator" ("you" is for site UI copy only), and
  with images under `docs/images/<topic>/`. Each doc gets a bullet in
  the README's Documentation list and a link from the doc beside it.
- `mise run checks:docs` checks every `mise run` task a doc names, and
  refuses any npm script: every command is a mise task.
