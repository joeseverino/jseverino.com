#!/usr/bin/env node
// Refresh the committed GitHub repo snapshot (src/data/github-repos.json), the
// only source src/lib/github.ts reads: builds never call GitHub. Run it after
// editing repo descriptions or adding repos, and commit the result.
//
//   npm run snapshot:github
//
// Requires the `gh` CLI authenticated as the repo owner.

import { writeFileSync } from 'node:fs';
import { runSync } from './lib/run.ts';
import { SITE } from '../src/lib/site-config.ts';

const JQ = [
  '[.[] | {',
  'name,',
  'description: (.description // ""),',
  'url,',
  'language: (.primaryLanguage.name // null),',
  'pushedAt: .pushedAt[0:7],',
  'fork: .isFork,',
  'archived: false',
  '}] | sort_by(.name)',
].join(' ');

const raw = runSync(
  'gh',
  [
    'repo', 'list', SITE.github,
    '--visibility', 'public',
    '--no-archived',
    '--limit', '100',
    '--json', 'name,description,url,primaryLanguage,pushedAt,isFork',
    '-q', JQ,
  ],
  { raw: true },
);

const repos = JSON.parse(raw);
writeFileSync('src/data/github-repos.json', `${JSON.stringify(repos, null, 2)}\n`);
console.log(`Wrote src/data/github-repos.json (${repos.length} repos).`);
