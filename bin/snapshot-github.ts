#!/usr/bin/env node
// Refresh src/data/github-repos.json, the only source src/lib/github.ts reads
// (builds never call GitHub). Commit the result.
//
//   mise run snapshot:github
//
// Requires the `gh` CLI authenticated as the repo owner.
import { writeFileSync } from 'node:fs';
import { cli } from './lib/args.ts';
import { runSync } from './lib/run.ts';
import { SITE } from '../src/lib/site-config.ts';
import { fromRoot } from '../src/lib/site-root.ts';

cli({ usage: 'usage: node bin/snapshot-github.ts' });
const LIMIT = 1000;
const OUTPUT = 'src/data/github-repos.json';

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
    '--limit', String(LIMIT),
    '--json', 'name,description,url,primaryLanguage,pushedAt,isFork',
    '-q', JQ,
  ],
  { raw: true },
);

const repos: unknown[] = JSON.parse(raw);
if (repos.length >= LIMIT) {
  console.error(`failed: gh returned ${repos.length} repos, the --limit; raise LIMIT so none are dropped. Nothing written.`);
  process.exit(1);
}
writeFileSync(fromRoot(OUTPUT), `${JSON.stringify(repos, null, 2)}\n`);
console.log(`Wrote ${OUTPUT} (${repos.length} repos).`);
