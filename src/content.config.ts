import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { pagesSchema, writeupsSchema } from './generated/content-schema';

// The repo lives in an iCloud-synced folder, so iCloud spawns numbered conflict
// copies ("home 4.md", "building-a-homelab 2/") whenever sync-content rewrites
// these generated dirs. Exclude them so a stray copy can never reach a build.
const ignoreConflictCopies = ['!**/* [0-9]*.md', '!**/* [0-9]*/**'];

const pages = defineCollection({
  loader: glob({
    pattern: ['**/*.md', ...ignoreConflictCopies],
    base: './src/content/pages',
  }),
  schema: pagesSchema,
});

const writeups = defineCollection({
  loader: glob({
    pattern: ['**/*.md', ...ignoreConflictCopies],
    base: './src/content/writeups',
  }),
  schema: writeupsSchema,
});

export const collections = { pages, writeups };
