// The repository root. Import this instead of counting '..', which breaks when a file moves.
import path from 'node:path';

export const siteRoot = path.resolve(import.meta.dirname, '../..');

export const fromRoot = (...segments: string[]): string => path.join(siteRoot, ...segments);

// The checkout's gitignored .cache/, for output that belongs to this checkout alone (test and
// audit results, the visual fixture build, the drafts overlay), so worktrees never overwrite
// each other's runs. Caches every checkout shares live under SITE_CACHE_DIR instead.
export const fromCheckoutCache = (...segments: string[]): string => fromRoot('.cache', ...segments);
