// Single source for the static build's output directory. The write side
// (astro.config.mjs, bin/build-static.mjs) and the read side (post-build
// audits, seo-preview, diff-build) must agree on this, or a verifier inspects
// a stale tree while the build wrote somewhere else — the bug class this
// module exists to prevent.
import fs from 'node:fs';
import path from 'node:path';

// Where the build writes: `dist/` on Cloudflare Pages (it sets CF_PAGES=1),
// `dist.nosync/` locally. The `.nosync` suffix keeps iCloud Drive from
// syncing and evicting build output — without it, every build and clean
// crawls through the iCloud FileProvider.
export const buildOutDir = () => (process.env.CF_PAGES ? 'dist' : 'dist.nosync');

// Where a verifier finds the most recent build output, local or CI.
// Returns the absolute path, or null when nothing has been built.
export function resolveBuiltDir(siteRoot) {
  return (
    ['dist.nosync', 'dist']
      .map((dir) => path.join(siteRoot, dir))
      .find((dir) => fs.existsSync(dir)) ?? null
  );
}
