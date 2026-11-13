// Commits a built site to the dist branch, one commit per change. See docs/Dist-Branch.md.
//
//   node bin/publish-dist.ts [dir] [--push] [--archive-sha256 <hex>] [--attestation <url>]

import { buildOutDir } from '../src/lib/build-output.ts';
import { DIST_BRANCH } from '../src/lib/site-config.ts';
import { siteRoot } from '../src/lib/site-root.ts';
import { cli, flag } from './lib/args.ts';
import { publishDist } from './lib/dist.ts';
import { git } from './lib/git.ts';

const { values, positionals } = cli({
  usage: `usage: node bin/publish-dist.ts [dir] [--push] [--archive-sha256 <hex>] [--attestation <url>]

  dir               The built site (default: ${buildOutDir}).
  --push            Push to origin. With GITHUB_TOKEN and GITHUB_REPOSITORY (Actions sets both) the
                    commit is created through the API, which GitHub signs; otherwise it is pushed unsigned.
  --archive-sha256  The digest of the attested archive dir was unpacked from, for the commit's trailer.
  --attestation     The archive's provenance attestation URL, for the commit's trailer.

In Actions the commit's Run trailer names the run, from GITHUB_SERVER_URL, GITHUB_REPOSITORY and
GITHUB_RUN_ID.`,
  allowPositionals: true,
  options: { push: flag, 'archive-sha256': { type: 'string' }, attestation: { type: 'string' } },
});

const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId, GITHUB_TOKEN: token } = process.env;

const result = await publishDist({
  repo: siteRoot,
  dir: positionals[0] ?? buildOutDir,
  sha: git(siteRoot, 'rev-parse', 'HEAD'),
  trailers: {
    Run: server && repository && runId ? `${server}/${repository}/actions/runs/${runId}` : undefined,
    'Archive-SHA256': values['archive-sha256'],
    Attestation: values.attestation,
  },
  push: values.push,
  token,
  repository,
});
console.log(`${result.status} ${result.commit.slice(0, 12)} on ${DIST_BRANCH}`);
