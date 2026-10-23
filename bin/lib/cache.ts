// Local state kept between runs. Caches live under the one cache root mise's [env] names
// (SITE_CACHE_DIR), shared by every checkout and worktree; the drafts overlay is this
// checkout's own content, so it stays in the checkout's cache.
import path from 'node:path';
import { fromCheckoutCache } from '../../src/lib/site-root.ts';

export function cacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SITE_CACHE_DIR;
  if (!root) throw new Error('SITE_CACHE_DIR is unset: run the command through mise (`mise run <task>`), whose [env] sets it');
  return path.resolve(root);
}

// The drafts preview's content root (SITE_CONTENT_ROOT for `astro dev`).
export const draftsOverlay = (): string => fromCheckoutCache('drafts');
