// A writeup as a self-contained preview page: Astro's container renders WriteupPreview in a Vite SSR server,
// with base.css bundled and Inter inlined so it works from a file or sandboxed iframe.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getViteConfig } from 'astro/config';
import { createLogger, createServer } from 'vite';
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

export async function renderDocument(input: DocumentInput): Promise<string> {
  // The Vite root is where Astro looks for the tsconfig and its path aliases. The site config is
  // left unloaded: its Cloudflare adapter makes the SSR environment workerd, which Node cannot run.
  // The toolbar off keeps dev-only source annotations out of the markup.
  const astro = { root: ROOT, configFile: false, logLevel: 'silent', devToolbar: { enabled: false } } as const;
  const config = await getViteConfig({ root: ROOT }, astro)({ command: 'serve', mode: 'development' });
  const server = await createServer({
    ...config,
    configFile: false,
    root: ROOT,
    customLogger: createLogger('silent'),
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
    const html: string = await container.renderToString(WriteupPreview, { props: input });
    const page = html.replace('</head>', `<style>${styles}</style></head>`);
    return page.startsWith('<!doctype') ? page : `<!doctype html>\n${page}`;
  } finally {
    await server.close();
  }
}
