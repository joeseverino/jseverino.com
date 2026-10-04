// A writeup as a self-contained preview page: Astro's container renders
// WriteupPreview (the shipped ArticleView markup) inside a Vite SSR server
// built from the site's own Astro config, with base.css bundled by Vite and
// Inter inlined, so the page works from a file or a sandboxed iframe.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger, createServer } from 'vite';
import { getViteConfig } from 'astro/config';
import { brandVarsCss } from '../../src/lib/brand.ts';
import { interFontFace } from '../../src/lib/web-styles.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FONT = path.join(ROOT, 'public/assets/fonts/inter/inter-variable-latin.woff2');

export interface DocumentInput {
  title: string;
  date: string;
  technologies: string[];
  heroSrc?: string;
  heroAlt?: string;
  body: string;
}

const silent = (): ReturnType<typeof createLogger> => {
  const logger = createLogger('silent');
  logger.error = () => {};
  return logger;
};

export async function renderDocument(input: DocumentInput): Promise<string> {
  const config = await getViteConfig({}, { root: ROOT, logLevel: 'silent' })({ command: 'serve', mode: 'development' });
  const server = await createServer({
    ...config,
    configFile: false,
    root: ROOT,
    customLogger: silent(),
    logLevel: 'silent',
    cacheDir: path.join(os.tmpdir(), 'site-render-vite'),
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { experimental_AstroContainer } = await server.ssrLoadModule('astro/container');
    const { default: WriteupPreview } = await server.ssrLoadModule('/src/components/content/WriteupPreview.astro');
    const { default: baseCss } = await server.ssrLoadModule('/src/styles/base.css?inline');
    const font = `data:font/woff2;base64,${fs.readFileSync(FONT).toString('base64')}`;
    const styles = [brandVarsCss(), baseCss, interFontFace(font)].join('\n');
    const container = await experimental_AstroContainer.create();
    const html: string = await container.renderToString(WriteupPreview, { props: { ...input, styles } });
    return html.startsWith('<!doctype') ? html : `<!doctype html>\n${html}`;
  } finally {
    await server.close();
  }
}
