import { defineCollection, z } from 'astro:content';

const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    path: z.string(),
    published: z.boolean().default(true),
  }),
});

const writeups = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    excerpt: z.string().optional(),
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
