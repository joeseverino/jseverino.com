// A SITE_CONTENT_ROOT outside src/content carries its own public/ tree; the dev server serves it before the repo's public/.
import fs from 'node:fs';
import path from 'node:path';
import type { AstroIntegration } from 'astro';

const TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

export function contentOverlay(contentRoot: string | undefined): AstroIntegration {
  return {
    name: 'content-overlay',
    hooks: {
      'astro:server:setup': ({ server }) => {
        if (!contentRoot) return;
        const publicDir = path.resolve(contentRoot, 'public');
        server.middlewares.use((request, response, next) => {
          const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://overlay').pathname);
          const file = path.resolve(publicDir, `.${pathname}`);
          if (!file.startsWith(publicDir + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
            next();
            return;
          }
          response.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
          fs.createReadStream(file).pipe(response);
        });
      },
    },
  };
}
