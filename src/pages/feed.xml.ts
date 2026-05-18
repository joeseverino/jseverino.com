import rss from '@astrojs/rss';
import { getWriteups } from '@lib/content';
import { site } from '@lib/site';

export async function GET(context: { site: string }) {
  return rss({
    title: site.defaultTitle,
    description: site.defaultDescription,
    site: context.site,
    items: (await getWriteups()).map((writeup) => ({
      title: writeup.title,
      description: writeup.excerpt,
      pubDate: new Date(`${writeup.date}T00:00:00Z`),
      link: `/portfolio/${writeup.slug}/`,
    })),
  });
}
