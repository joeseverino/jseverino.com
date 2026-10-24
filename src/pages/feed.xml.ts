import rss from '@astrojs/rss';
import { getWriteups } from '@lib/content.ts';
import { site } from '@lib/site.ts';
import { writeupPath } from '@lib/site-config.ts';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async () =>
  rss({
    title: site.defaultTitle,
    description: site.defaultDescription,
    site: site.url,
    items: (await getWriteups()).map((writeup) => ({
      title: writeup.title,
      description: writeup.description,
      pubDate: new Date(writeup.date),
      link: writeupPath(writeup.slug),
    })),
  });
