// Single source for the static build's output directory. The write side
// (astro.config.ts, bin/build-static.ts) and the read side (post-build
// audits, seo-preview, diff-build) must agree on this, or a verifier inspects
// a stale tree while the build wrote somewhere else.
import fs from 'node:fs';
import path from 'node:path';

export const buildOutDir = 'dist';

// The absolute path of the most recent build output, or null when nothing has
// been built.
export function resolveBuiltDir(siteRoot: string): string | null {
  const dir = path.join(siteRoot, buildOutDir);
  return fs.existsSync(dir) ? dir : null;
}
