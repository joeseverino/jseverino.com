#!/usr/bin/env node
// Commits a built site to the dist branch, one commit per change. See docs/Dist-Branch.md.
//
//   node bin/publish-dist.ts <dir> [--branch dist] [--push]
import { buildOutDir } from '../src/lib/build-output.ts';
import { DEFAULT_BRANCH } from '../src/lib/site-config.ts';
import { siteRoot } from '../src/lib/site-root.ts';
import { cli, flag } from './lib/args.ts';
import { publishDist } from './lib/dist.ts';
import { git } from './lib/git.ts';

const { values, positionals } = cli({
  usage: `usage: node bin/publish-dist.ts [dir] [--branch dist] [--push]

  dir       The built site (default: ${buildOutDir}).
  --branch  The branch to publish to (default: dist).
  --push    Push to origin. With GITHUB_TOKEN and GITHUB_REPOSITORY (Actions sets both) the commit
            is created through the API, which GitHub signs; otherwise it is pushed unsigned.`,
  allowPositionals: true,
  options: { branch: { type: 'string', default: 'dist' }, push: flag },
});

if (values.branch === DEFAULT_BRANCH) throw new Error(`refusing to publish over ${DEFAULT_BRANCH}`);
const result = await publishDist({
  repo: siteRoot,
  dir: positionals[0] ?? buildOutDir,
  branch: values.branch,
  sha: git(siteRoot, 'rev-parse', 'HEAD'),
  push: values.push,
  token: process.env.GITHUB_TOKEN,
  repository: process.env.GITHUB_REPOSITORY,
});
console.log(`${result.status} ${result.commit.slice(0, 12)} on ${values.branch}`);
