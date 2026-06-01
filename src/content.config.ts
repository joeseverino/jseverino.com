import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// The repo lives in an iCloud-synced folder, so iCloud spawns numbered conflict
// copies ("home 4.md", "building-a-homelab 2/") whenever sync-content rewrites
// these generated dirs. Exclude them so a stray copy can never reach a build.
const ignoreConflictCopies = ['!**/* [0-9]*.md', '!**/* [0-9]*/**'];

const pages = defineCollection({
  loader: glob({
    pattern: ['**/*.md', ...ignoreConflictCopies],
    base: './src/content/pages',
  }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    intro: z.string().optional(),
    path: z.string().optional(),
    published: z.boolean().default(true),
  }),
});

const writeups = defineCollection({
  loader: glob({
    pattern: ['**/*.md', ...ignoreConflictCopies],
    base: './src/content/writeups',
  }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    published: z.boolean().default(false),
    published_at: z.coerce.date().optional(),
    last_reviewed: z.coerce.date().optional(),
    cover_image: z.string().optional(),
    cover_alt: z.string().optional(),
    technologies: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    featured_order: z.number().int().optional(),
  }),
});

// Single-entry collection for site-wide identity, social links, and navigation.
// Sourced from the vault `06 Pages/_site.md` and synced into
// `src/content/site.md` by `bin/sync-content.mjs`. The Zod schema validates
// every required field at build time.
const site = defineCollection({
  loader: glob({
    pattern: 'site.md',
    base: './src/content',
  }),
  schema: z.object({
    name: z.string(),
    title: z.string(),
    summary: z.string(),
    skills: z.array(z.string()),
    socialLinks: z.array(
      z.object({
        label: z.string(),
        href: z.string().url(),
      }),
    ),
    navItems: z.array(
      z.object({
        label: z.string(),
        href: z.string(),
      }),
    ),
  }),
});

export const collections = { pages, writeups, site };
