import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    path: z.string(),
    published: z.boolean().default(true),
  }),
});

const writeups = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writeups' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    published: z.boolean().default(false),
    published_at: z.coerce.date().optional(),
    last_reviewed: z.coerce.date().optional(),
    cover_image: z.string().optional(),
    technologies: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    featured_order: z.number().int().optional(),
  }),
});

export const collections = { pages, writeups };
