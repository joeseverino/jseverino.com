#!/usr/bin/env node
// Refresh src/data/github-repos.json, the only source src/lib/github.ts reads
// (builds never call GitHub). Commit the result.
//
//   mise run snapshot:github
//
// The token comes from GITHUB_TOKEN, then GH_TOKEN, then `gh auth token`.
import { writeFileSync } from 'node:fs';
import { cli } from './lib/args.ts';
import { createClient, resolveToken } from './lib/github.ts';
import type { GithubRepo } from '../src/lib/github.ts';
import { SITE } from '../src/lib/site-config.ts';
import { fromRoot } from '../src/lib/site-root.ts';

cli({ usage: 'usage: node bin/snapshot-github.ts' });
const OUTPUT = 'src/data/github-repos.json';

// The REST fields the snapshot keeps. This endpoint lists public repositories only.
interface Repository {
  name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  pushed_at: string;
  fork: boolean;
  archived: boolean;
}

const github = createClient({ token: resolveToken() });
const repos: GithubRepo[] = (await github.list<Repository>(`/users/${SITE.github}/repos?per_page=100`))
  .map((repo) => ({
    archived: repo.archived,
    description: repo.description ?? '',
    fork: repo.fork,
    language: repo.language,
    name: repo.name,
    pushedAt: repo.pushed_at.slice(0, 7),
    url: repo.html_url,
  }))
  // Code-point order, so the committed file only moves when the data does.
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

writeFileSync(fromRoot(OUTPUT), `${JSON.stringify(repos, null, 2)}\n`);
console.log(`Wrote ${OUTPUT} (${repos.length} repos).`);
