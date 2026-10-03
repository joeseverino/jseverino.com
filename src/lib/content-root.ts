import path from 'node:path';

// Where the build reads content from. SITE_CONTENT_ROOT points it at a
// self-contained tree: tests/fixtures/content, so the visual baselines never
// move with a publish, or the gitignored drafts overlay `site dev --drafts`
// syncs. Such a build is hermetic and makes no network calls.
export const contentRoot = process.env.SITE_CONTENT_ROOT ?? 'src/content';
export const fixtureContent = Boolean(process.env.SITE_CONTENT_ROOT);

// The content roots a build may read besides src/content: a tree under
// tests/fixtures, or the drafts overlay. bin/build-static.ts refuses any other,
// so a stray SITE_CONTENT_ROOT stops the production build.
export function permittedContentRoot(value: string, root: string): boolean {
  const resolved = path.resolve(root, value);
  const fixtures = path.join(root, 'tests', 'fixtures');
  return resolved.startsWith(fixtures + path.sep) || resolved === path.join(root, '.cache', 'drafts');
}
