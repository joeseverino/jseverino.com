// Local, gitignored state the scripts keep between runs: the image-encode
// cache and the drafts overlay. It lives in the repo's .cache/, outside
// node_modules, so `npm ci` keeps it. SITE_CACHE_DIR points a temporary
// worktree (site publish) at the checkout's cache.
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../../src/lib/site-root.ts';

export const cacheDir = (env: NodeJS.ProcessEnv = process.env): string => path.resolve(env.SITE_CACHE_DIR || path.join(siteRoot, '.cache'));

// The drafts preview's content root (SITE_CONTENT_ROOT for `astro dev`).
export const draftsOverlay = (): string => path.join(siteRoot, '.cache', 'drafts');

// The image cache under its earlier home, node_modules/.cache/jseverino-img,
// with the same <lineage>/<name> layout.
export const legacyImageCache = (root = siteRoot): string => path.join(root, 'node_modules/.cache/jseverino-img');

// Moves the earlier image cache into place once, so the first sync after the
// move reuses every encode instead of rewriting each variant. Runs only while
// the new cache does not exist; returns whether it moved anything.
export function adoptLegacyImageCache(target: string, legacy = legacyImageCache()): boolean {
  if (fs.existsSync(target) || !fs.existsSync(legacy)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(legacy, target);
  } catch {
    // Across devices (a symlinked node_modules): copy instead.
    fs.cpSync(legacy, target, { recursive: true });
  }
  return true;
}
