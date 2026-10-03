import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { pagesSchema, writeupsSchema } from './generated/content-schema.ts';
import { contentRoot } from './lib/content-root.ts';

const pages = defineCollection({
  loader: glob({ pattern: '**/index.mdx', base: `${contentRoot}/pages` }),
  schema: pagesSchema,
});

const writeups = defineCollection({
  loader: glob({ pattern: '**/index.mdx', base: `${contentRoot}/writeups` }),
  schema: writeupsSchema,
});

export const collections = { pages, writeups };
