#!/usr/bin/env node
// Internal link integrity over the built HTML: every href, src, srcset and poster (including
// same-origin absolute URLs) resolves to an emitted file.

import fs from 'node:fs';
import path from 'node:path';
import { SITE_ORIGIN as origin } from '../../src/lib/site-config.ts';
import { builtPages, finish } from './lib.ts';

const { distDir, pages } = builtPages('check-links');

// Routes served by Cloudflare Pages functions, not by emitted files.
const DYNAMIC_ROUTE_PREFIXES = ['/api/', '/__sitedrift/', '/cdn-cgi/'];

// Normalize a reference to a root-relative pathname, or null when it is out
// of scope (external origin, mailto:, data:, fragment-only, …).
function internalPathname(reference: string, pageDir: string): string | null {
  let value = reference.trim();
  if (!value || value.startsWith('#')) return null;
  if (value.startsWith(origin)) value = value.slice(origin.length) || '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return null;

  const withoutSuffix = value.split('#')[0]?.split('?')[0];
  if (!withoutSuffix) return null;

  const resolved = withoutSuffix.startsWith('/')
    ? withoutSuffix
    : `/${path.posix.join(pageDir, withoutSuffix)}`;
  try {
    return decodeURI(resolved);
  } catch {
    return resolved;
  }
}

function resolvesInDist(pathname: string): boolean {
  if (DYNAMIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  const target = path.join(distDir, pathname);
  if (pathname.endsWith('/')) return fs.existsSync(path.join(target, 'index.html'));
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return true;
  return fs.existsSync(path.join(target, 'index.html'));
}

const failures: string[] = [];
let referenceCount = 0;
const checked = new Map<string, boolean>();

for (const { rel, html } of pages) {
  const pageDir = path.posix.dirname(`/${rel.split(path.sep).join('/')}`);

  const references: string[] = [];
  for (const [, reference = ''] of html.matchAll(/(?:href|src|poster)=["']([^"']+)["']/g)) {
    references.push(reference);
  }
  for (const [, srcset = ''] of html.matchAll(/srcset=["']([^"']+)["']/g)) {
    for (const candidate of srcset.split(',')) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) references.push(url);
    }
  }

  for (const reference of references) {
    const pathname = internalPathname(reference, pageDir);
    if (!pathname) continue;
    referenceCount += 1;
    if (!checked.has(pathname)) checked.set(pathname, resolvesInDist(pathname));
    if (!checked.get(pathname)) failures.push(`${rel}: ${reference}`);
  }
}

finish(failures, `${pages.length} pages, ${referenceCount} internal references (${checked.size} unique) resolve`, {
  heading: 'check-links: internal references that do not resolve in the build output:',
});
