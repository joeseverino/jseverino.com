// Every built page carries the metadata search engines and link previews read,
// and its og:image is a file the build emitted. built:html holds the <title>.
import fs from 'node:fs';
import path from 'node:path';
import { elementsNamed, linkHref, metaContent, parseHtml, textContent } from '../../src/lib/html.ts';
import { SITE_ORIGIN } from '../../src/lib/site-config.ts';
import { builtPages, finish } from './lib.ts';

const { distDir, pages } = builtPages('check-seo');

// SeoHead.astro writes og:image as an absolute URL on the site; it must name an emitted file.
function imageProblem(content: string): string | undefined {
  const url = URL.parse(content);
  if (url?.origin !== SITE_ORIGIN) return `og:image ${content} is not a ${SITE_ORIGIN} URL`;
  const file = path.join(distDir, decodeURIComponent(url.pathname));
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? undefined : `og:image ${url.pathname} is not in the build`;
}

const problems = pages.flatMap(({ rel, html }) => {
  const doc = parseHtml(html);
  const image = metaContent(doc, 'og:image');
  const found = [
    linkHref(doc, 'canonical') ? undefined : 'no canonical link',
    metaContent(doc, 'og:title') ? undefined : 'no og:title',
    image ? imageProblem(image) : 'no og:image',
    ...elementsNamed(doc, 'script')
      .filter((script) => script.properties.type === 'application/ld+json')
      .map((script) => {
        try {
          JSON.parse(textContent(script));
          return undefined;
        } catch {
          return 'invalid JSON-LD';
        }
      }),
  ];
  return found.filter((problem) => problem !== undefined).map((problem) => `${rel}: ${problem}`);
});

finish(problems, `${pages.length} pages: canonical, og:title, og:image in the build, valid JSON-LD`, {
  heading: 'check-seo: pages with missing or invalid SEO metadata:',
  fix: 'fix: check src/components/SeoHead.astro and the page frontmatter',
});
