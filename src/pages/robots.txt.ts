import { site } from '@lib/site';

const aiTrainingCrawlers = ['GPTBot', 'CCBot', 'Google-Extended', 'ClaudeBot', 'Bytespider'];

export function GET() {
  const lines = [
    'User-agent: *',
    'Content-Signal: search=yes,ai-train=no',
    'Allow: /',
    '',
    ...aiTrainingCrawlers.map((bot) => `User-agent: ${bot}`),
    'Disallow: /',
    '',
    `Sitemap: ${new URL('/sitemap-index.xml', site.url).href}`,
    '',
  ];
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
