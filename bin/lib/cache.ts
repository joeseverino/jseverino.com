// Local, gitignored state between runs (image-master cache, drafts overlay) in .cache/, outside node_modules
// so `npm ci` keeps it. SITE_CACHE_DIR points a temporary worktree at the checkout's cache.
import path from 'node:path';
import { siteRoot } from '../../src/lib/site-root.ts';

export const cacheDir = (env: NodeJS.ProcessEnv = process.env): string => path.resolve(env.SITE_CACHE_DIR || path.join(siteRoot, '.cache'));

// The drafts preview's content root (SITE_CONTENT_ROOT for `astro dev`).
export const draftsOverlay = (): string => path.join(siteRoot, '.cache', 'drafts');
