// Writers and readers of the build output must agree on these directories, or a verifier inspects a stale tree.
import fs from 'node:fs';
import path from 'node:path';

// Astro's outDir. The Cloudflare adapter writes the Worker and its deploy config to server/.
export const astroOutDir = 'dist';
// The static site the assets layer serves: every page, image, _headers and _redirects.
export const buildOutDir = `${astroOutDir}/client`;
// The deploy config the adapter writes, which `wrangler dev` and `wrangler deploy` read.
export const workerConfig = `${astroOutDir}/server/wrangler.json`;
// What bin/build-csp.ts filled in: the _headers template and each page's hashes. Outside the
// served tree, so it is never deployed, and a later run on the same build (the preview wrap) starts from it.
export const cspRecord = `${astroOutDir}/csp.json`;

// The most recent build output, or null when nothing has been built.
export function resolveBuiltDir(siteRoot: string): string | null {
  const dir = path.join(siteRoot, buildOutDir);
  return fs.existsSync(dir) ? dir : null;
}
