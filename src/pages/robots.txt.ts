import { site } from '@lib/site';

export function GET() {
  return new Response(
    ['User-agent: *', 'Allow: /', `Sitemap: ${new URL('/sitemap-index.xml', site.url).href}`, ''].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
