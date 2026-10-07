#!/usr/bin/env node
// The GitHub repository posture in github/repo.json, checked against the live
// repository and applied on request. See docs/GitHub-Settings.md.
//
//   node bin/github.ts check [--json]    # read-only; exit 1 on drift
//   node bin/github.ts plan [--json]     # the calls an apply would make
//   node bin/github.ts apply [--yes]     # plan, or with --yes, execute
import { createClient, createRun, loadDesired, type ClientOptions } from './lib/github-settings.ts';
import { exitWith, toolMain, type ToolOptions } from './lib/drift.ts';
import { spawnResult } from './lib/run.ts';
import { fromRoot } from '../src/lib/site-root.ts';

export const USAGE = `usage: node bin/github.ts <check|plan|apply> [--json] [--yes]

  check   Read the live repository, diff against github/repo.json, print a
          table (--json for machine output). Exit 1 on drift.
  plan    The API calls an apply would make, without making them.
  apply   Prints the plan; with --yes, makes the calls, then re-checks.

The token comes from GITHUB_TOKEN, then GH_TOKEN, then \`gh auth token\`, and is
never printed. It needs repository Administration: read for check and plan,
write for apply (a classic token with the repo scope covers both).`;

const desiredFile = fromRoot('github/repo.json');
const schemaFile = fromRoot('github/repo.schema.json');

export interface MainOptions extends ToolOptions, Pick<ClientOptions, 'fetch'> {}

export const main = toolMain<MainOptions>({
  usage: USAGE,
  command: 'node bin/github.ts',
  setup: ({ env = process.env, fetch = globalThis.fetch }) =>
    createRun(loadDesired(desiredFile, schemaFile), createClient({ token: env.GITHUB_TOKEN ?? env.GH_TOKEN, fetch })),
});

if (import.meta.main) {
  await exitWith('github', () => {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? spawnResult('gh', ['auth', 'token']).stdout.trim();
    return main({ env: { ...process.env, GITHUB_TOKEN: token } });
  });
}
