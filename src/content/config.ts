import { defineCollection, z } from 'astro:content';

const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    path: z.string(),
    status: z.enum(['draft', 'published']).default('published'),
  }),
});

const writeups = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    excerpt: z.string().optional(),
    description: z.string().optional(),
    status: z.string().default('active'),
    sensitivity: z.string().default('public'),
    content_type: z.string().optional(),
    category: z.string().default('portfolio'),
    featured: z.boolean().default(false),
    featured_order: z.number().int().optional(),
    cover_image: z.string().optional(),
    technologies: z.array(z.string()).default([]),
    published_at: z.coerce.date().optional(),
    last_reviewed: z.coerce.date().optional(),
    external_url: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { pages, writeups };
