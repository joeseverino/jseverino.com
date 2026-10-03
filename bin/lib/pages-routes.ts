// public/_routes.json decides which requests invoke Pages Functions (the CSP
// middleware included) and which Pages serves straight from static assets.
// Rules are pathnames where `*` matches any run of characters, slashes
// included; an exclude beats an include. Limits per the Pages docs: at least
// one include, at most 100 rules in total, 100 characters per rule.
import fs from 'node:fs';
import path from 'node:path';
import { walkFiles } from '../../src/lib/walk.ts';
import { readJson } from '../../src/lib/json.ts';

export const MAX_RULES = 100;
export const MAX_RULE_LENGTH = 100;

export interface PagesRoutes {
  version: number;
  include: string[];
  exclude: string[];
}

// Trusted as PagesRoutes; shapeFindings is the check that it really is one.
export const readRoutes = (file: string): PagesRoutes => readJson(file);

const ruleRe = (rule: string): RegExp => new RegExp(`^${rule.split('*').map((part) => RegExp.escape(part)).join('.*')}$`);

export const matchesRule = (rule: string, pathname: string): boolean => ruleRe(rule).test(pathname);

// True when a request for pathname runs Functions.
export function invokesFunctions(routes: PagesRoutes, pathname: string): boolean {
  if (routes.exclude?.some((rule) => matchesRule(rule, pathname))) return false;
  return routes.include.some((rule) => matchesRule(rule, pathname));
}

export function shapeFindings(routes: PagesRoutes): string[] {
  const findings: string[] = [];
  if (routes.version !== 1) findings.push(`version is ${routes.version}, expected 1`);
  if (!Array.isArray(routes.include) || routes.include.length === 0) findings.push('include must list at least one rule');
  const rules = [...(routes.include ?? []), ...(routes.exclude ?? [])];
  if (rules.length > MAX_RULES) findings.push(`${rules.length} rules, Pages allows ${MAX_RULES}`);
  for (const rule of rules as unknown[]) {
    if (typeof rule !== 'string' || !rule.startsWith('/')) findings.push(`rule ${JSON.stringify(rule)} must be a pathname`);
    else if (rule.length > MAX_RULE_LENGTH) findings.push(`rule ${rule} exceeds ${MAX_RULE_LENGTH} characters`);
  }
  return findings;
}

// The URLs Pages serves a built HTML file at: /about/ and /about/index.html
// for a directory index, /404 and /404.html for a top-level file.
export function htmlUrls(relative: string): [string, string] {
  const file = `/${relative.split(path.sep).join('/')}`;
  if (file === '/index.html') return ['/', file];
  if (file.endsWith('/index.html')) return [file.slice(0, -'index.html'.length), file];
  return [file.slice(0, -'.html'.length), file];
}

// Representative request paths for each file-based Function route, from the
// functions/ tree: api/contact.ts → /api/contact, __sitedrift/[[path]].ts →
// /__sitedrift/x. The root middleware applies to whatever invokes Functions.
export function functionPaths(functionsDir: string): string[] {
  const routeFile = (file: string, entry: fs.Dirent): boolean => {
    const dirs = path.relative(functionsDir, file).split(path.sep).slice(0, -1);
    return !dirs.some((dir) => dir === 'lib' || dir === 'generated') && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.startsWith('_');
  };
  return walkFiles(functionsDir, { filter: routeFile }).map((file) => {
    const segments = path.relative(functionsDir, file).slice(0, -3).split(path.sep);
    const name = segments.pop() ?? '';
    const segment = name.startsWith('[') ? 'x' : name === 'index' ? '' : name;
    return `/${[...segments, segment].join('/')}`.replace(/\/$/, '') || '/';
  });
}

// A miss under an excluded path never reaches the middleware: the asset
// server answers with the nearest 404.html at or above the requested
// directory. So each exclude is either an exact file the build emits, or a
// `/<dir>/*` prefix that carries its own fallback page (no script, no style,
// no nonce placeholder) and a static CSP from public/_headers. The top-level
// 404.html, which needs the middleware's nonce, is then never served
// statically.
export const STATIC_FALLBACK = '404.html';

export const prefixExcludes = (routes: PagesRoutes): string[] =>
  (routes.exclude ?? []).flatMap((rule) => /^\/([^*]+)\/\*$/.exec(rule)?.[1] ?? []);

export function excludeFindings(routes: PagesRoutes, distDir: string): string[] {
  const findings: string[] = [];
  for (const rule of routes.exclude ?? []) {
    if (/^\/[^*]+\/\*$/.test(rule)) continue;
    if (rule.includes('*')) findings.push(`exclude ${rule} is a partial wildcard; a miss under it gets the nonce-dependent /404.html statically`);
    else if (!fs.existsSync(path.join(distDir, rule))) findings.push(`exclude ${rule} names a file the build does not emit, so a request for it gets /404.html statically`);
  }
  return findings;
}

// The fallback page itself: plain markup that renders under the static CSP.
export const STATIC_FALLBACK_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Not found</title>
</head>
<body>
<h1>Not found</h1>
<p>Nothing is served at this address. <a href="/">Go to the home page</a>.</p>
</body>
</html>
`;

export const fallbackFiles = (routes: PagesRoutes): string[] => prefixExcludes(routes).map((dir) => `${dir}/${STATIC_FALLBACK}`);

// Called by bin/build-static.ts after the sitedrift wrap, so a preview build
// does not wrap these in its viewer.
export function writeStaticFallbacks(distDir: string): string[] {
  const files = fallbackFiles(readRoutes(path.join(distDir, '_routes.json')));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(distDir, file)), { recursive: true });
    fs.writeFileSync(path.join(distDir, file), STATIC_FALLBACK_HTML);
  }
  return files;
}

export function fallbackFindings(html: string): string[] {
  const findings: string[] = [];
  if (/<script\b/i.test(html)) findings.push('carries a script tag');
  if (/<style\b|\sstyle=/i.test(html)) findings.push('carries inline style');
  if (/\snonce=/i.test(html)) findings.push('carries a nonce attribute');
  return findings;
}

// public/_headers as path rules to header lines, in file order. A `!` line
// (a detach) is kept as written.
export function parseHeaders(text: string): Map<string, string[]> {
  const rules = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) current?.push(line.trim());
    else rules.set(line.trim(), (current = rules.get(line.trim()) ?? []));
  }
  return rules;
}
