// The sitemap index and the URL lists it points to, walked the same way by the
// live deploy check and the route spec. read() fetches one document by its
// <loc> (the canonical URL) and fails however its caller fails.
export const sitemapLocs = (xml: string): string[] => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc = '']) => loc);

export async function sitemapUrls(index: string, read: (url: string) => Promise<string>): Promise<string[]> {
  const urls: string[] = [];
  for (const sitemap of sitemapLocs(await read(index))) urls.push(...sitemapLocs(await read(sitemap)));
  return urls;
}
