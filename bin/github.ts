#!/usr/bin/env node

// The GitHub repository posture in .github/repo.json, checked against the live
// repository and applied on request. See docs/GitHub-Settings.md.
//
//   node bin/github.ts check [--json]    # read-only; exit 1 on drift
//   node bin/github.ts plan [--json]     # the calls an apply would make
//   node bin/github.ts apply [--yes]     # plan, or with --yes, execute

import { fromRoot } from '../src/lib/site-root.ts';
import { exitWith } from './lib/args.ts';
import { type ToolOptions, toolMain } from './lib/drift.ts';
import { type ClientOptions, createClient, resolveToken } from './lib/github.ts';
import { createRun, loadDesired } from './lib/github-settings.ts';

export const USAGE = `usage: node bin/github.ts <check|plan|apply> [--json] [--yes]

  check   Read the live repository, diff against .github/repo.json, print a
          table (--json for machine output). Exit 1 on drift.
  plan    The API calls an apply would make, without making them.
  apply   Prints the plan; with --yes, makes the calls, then re-checks.

The token comes from GITHUB_TOKEN, then GH_TOKEN, then \`gh auth token\`, and is
never printed. It needs repository Administration: read for check and plan,
write for apply (a classic token with the repo scope covers both).`;

const desiredFile = fromRoot('.github/repo.json');
const schemaFile = fromRoot('.github/repo.schema.json');

export interface MainOptions extends ToolOptions, Pick<ClientOptions, 'fetch'> {}

export const main = toolMain<MainOptions>({
  usage: USAGE,
  command: 'node bin/github.ts',
  // Tests pass the token in env; the command line resolves it below.
  setup: ({ env = process.env, fetch }) => createRun(loadDesired(desiredFile, schemaFile), createClient({ token: env.GITHUB_TOKEN, fetch })),
});

if (import.meta.main) {
  await exitWith('github', () => main({ env: { ...process.env, GITHUB_TOKEN: resolveToken() } }));
}
