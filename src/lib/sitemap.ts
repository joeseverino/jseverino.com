// Walked by the live deploy check and the route spec. read() fetches one document by its <loc>.
import { tagPath } from './site-config.ts';

export const sitemapLocs = (xml: string): string[] => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc = '']) => loc);

export async function sitemapUrls(index: string, read: (url: string) => Promise<string>): Promise<string[]> {
  const urls: string[] = [];
  for (const sitemap of sitemapLocs(await read(index))) urls.push(...sitemapLocs(await read(sitemap)));
  return urls;
}

export interface LastmodWriteup {
  url: string;
  technologies: readonly string[];
  /** last_reviewed, else published_at. */
  date: Date | string | undefined;
}

// `lastmod` only when true: a writeup's reviewed date, or the newest date among the writeups a
// listing page shows. Others get none rather than the build time, which claims every page changed.
export function sitemapLastmods(writeups: readonly LastmodWriteup[], origin: string): Map<string, string> {
  const dated = writeups.flatMap((writeup) => {
    const time = writeup.date === undefined ? Number.NaN : new Date(writeup.date).getTime();
    return Number.isNaN(time) ? [] : [{ ...writeup, time }];
  });
  const lastmods = new Map<string, string>();
  const newest = new Map<string, number>();
  const bump = (url: string, time: number) => newest.set(url, Math.max(newest.get(url) ?? 0, time));

  for (const { url, technologies, time } of dated) {
    lastmods.set(url, new Date(time).toISOString());
    bump(`${origin}/`, time);
    bump(`${origin}/portfolio/`, time);
    for (const slug of technologies) bump(`${origin}${tagPath(slug)}`, time);
  }
  for (const [url, time] of newest) lastmods.set(url, new Date(time).toISOString());
  return lastmods;
}
