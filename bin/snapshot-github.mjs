#!/usr/bin/env node
// Refresh the committed GitHub repo snapshot that src/lib/github.ts falls back to
// when the live GitHub API is unreachable at build time. Run this after editing
// repo descriptions or adding repos so the fallback does not drift.
//
//   npm run snapshot:github
//
// Requires the `gh` CLI authenticated as the repo owner.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

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

const raw = execFileSync(
  'gh',
  [
    'repo', 'list', 'joeseverino',
    '--visibility', 'public',
    '--no-archived',
    '--limit', '100',
    '--json', 'name,description,url,primaryLanguage,pushedAt,isFork',
    '-q', JQ,
  ],
  { encoding: 'utf8' },
);

const repos = JSON.parse(raw);
writeFileSync('src/data/github-repos.json', `${JSON.stringify(repos, null, 2)}\n`);
console.log(`Wrote src/data/github-repos.json (${repos.length} repos).`);
