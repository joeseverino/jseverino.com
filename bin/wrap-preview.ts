#!/usr/bin/env node
// Turns a finished build into a branch preview: the sitedrift review viewer over every page, then
// the CSP filled again so it covers the viewer. sitedrift wraps only a Workers CI build of a branch
// other than main, so the deploy job sets WORKERS_CI=1 and WORKERS_CI_BRANCH on this step alone,
// and the build itself never wraps.
import { installCloudflarePreview } from 'sitedrift';
import { buildOutDir, cspRecord, workerConfig } from '../src/lib/build-output.ts';
import { CSP_INLINE_MARKER } from '../src/lib/csp.ts';
import { readJson } from '../src/lib/json.ts';
import { DEFAULT_BRANCH, SITE, SITE_ORIGIN } from '../src/lib/site-config.ts';
import { fromRoot } from '../src/lib/site-root.ts';
import { buildCsp } from './build-csp.ts';
import { cli } from './lib/args.ts';

cli({ usage: 'usage: WORKERS_CI=1 WORKERS_CI_BRANCH=<branch> node bin/wrap-preview.ts' });

// The upload reads the deploy config the pull request's build wrote, and the token can write any
// Worker on the account, so the config must name this one.
const { name } = readJson<{ name: string }>(fromRoot(workerConfig));
if (name !== SITE.worker) {
  console.error(`wrap-preview: ${workerConfig} names the Worker "${name}", not "${SITE.worker}"`);
  process.exit(1);
}

const dir = fromRoot(buildOutDir);
const wrap = installCloudflarePreview({
  dir,
  live: SITE_ORIGIN,
  brand: SITE.owner,
  productionBranch: DEFAULT_BRANCH,
  // Every inline tag the viewer writes carries the marker build-csp hashes.
  nonce: CSP_INLINE_MARKER,
});
if (!wrap.installed) {
  console.error(`wrap-preview: nothing wrapped (${wrap.reason})\nfix: set WORKERS_CI=1 and WORKERS_CI_BRANCH to a branch other than ${DEFAULT_BRANCH}`);
  process.exit(1);
}
const { scriptHashes, styleHashes } = await buildCsp(dir, fromRoot(cspRecord));
console.log(`wrap-preview: ${wrap.files} pages wrapped for ${wrap.branch}; the CSP covers ${scriptHashes.length} inline script and ${styleHashes.length} inline style hash(es)`);
