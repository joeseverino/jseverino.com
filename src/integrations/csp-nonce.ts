// Stamps the CSP nonce placeholder on the tags Astro itself emits, after the
// build writes each page. functions/_middleware.ts nonces only tags carrying
// the placeholder, so this is the whole allow-list of what may execute:
//
//   - the site's own is:inline scripts carry the placeholder in source;
//   - Astro's bundled scripts render as exactly
//     <script type="module" src="/_astro/…"></script>;
//   - Astro's inlined stylesheets render as <style> in <head>, where no
//     content renders.
//
// Anything else, a script or style that arrived through rendered content,
// stays without the placeholder and fails the build here rather than shipping.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { CSP_NONCE_ATTRIBUTE } from '../../functions/lib/csp-nonce.ts';

const ASTRO_SCRIPT = /<script type="module" src="\/_astro\/[^"<>\s]+"><\/script>/g;
const HEAD_STYLE = /<style>/g;
const SCRIPT_OR_STYLE = /<(?:script|style)\b[^>]*>/gi;

export function stampNonces(html: string): string {
  const headEnd = html.indexOf('</head>');
  const head = headEnd === -1 ? '' : html.slice(0, headEnd);
  const rest = headEnd === -1 ? html : html.slice(headEnd);
  const stamp = (tag: string) => tag.replace(/^<(script|style)/, `<$1 ${CSP_NONCE_ATTRIBUTE}`);
  return (head.replace(HEAD_STYLE, stamp) + rest).replace(ASTRO_SCRIPT, stamp);
}

export function unstampedTags(html: string): string[] {
  return [...html.matchAll(SCRIPT_OR_STYLE)].map(([tag]) => tag).filter((tag) => !tag.includes(CSP_NONCE_ATTRIBUTE));
}

function htmlFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

export function cspNonce(): AstroIntegration {
  return {
    name: 'csp-nonce',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const problems: string[] = [];
        const files = htmlFiles(root);
        for (const file of files) {
          const html = stampNonces(fs.readFileSync(file, 'utf8'));
          for (const tag of unstampedTags(html)) problems.push(`${path.relative(root, file)}: ${tag.slice(0, 120)}`);
          fs.writeFileSync(file, html);
        }
        if (problems.length > 0) {
          throw new Error(`script or style tags the site did not emit (they would run without a nonce):\n  ${problems.join('\n  ')}`);
        }
        logger.info(`stamped the CSP nonce placeholder in ${files.length} pages`);
      },
    },
  };
}
