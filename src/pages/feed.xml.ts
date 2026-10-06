import rss from '@astrojs/rss';
import { getWriteups } from '@lib/content.ts';
import { site } from '@lib/site.ts';
import { writeupPath } from '@lib/site-config.ts';

export async function GET(context: { site: string }) {
  return rss({
    title: site.defaultTitle,
    description: site.defaultDescription,
    site: context.site,
    items: (await getWriteups()).map((writeup) => ({
      title: writeup.title,
      description: writeup.description,
      pubDate: new Date(writeup.date),
      link: writeupPath(writeup.slug),
    })),
  });
}
