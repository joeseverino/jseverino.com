// Writers and readers of the build output must agree on this directory, or a verifier inspects a stale tree.
import fs from 'node:fs';
import path from 'node:path';

export const buildOutDir = 'dist';

// The most recent build output, or null when nothing has been built.
export function resolveBuiltDir(siteRoot: string): string | null {
  const dir = path.join(siteRoot, buildOutDir);
  return fs.existsSync(dir) ? dir : null;
}
