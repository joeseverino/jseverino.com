// public/_routes.json decides which requests invoke Pages Functions and which
// Pages serves straight from static assets. Every page is static, so only the
// Function routes are included. Rules are pathnames where `*` matches any run of
// characters, slashes included; an exclude beats an include. Limits per the
// Pages docs: at least one include, at most 100 rules in total, 100 characters
// per rule.
import fs from 'node:fs';
import path from 'node:path';
import { walkFiles } from '../../src/lib/walk.ts';
import { readJson } from '../../src/lib/json.ts';

const MAX_RULES = 100;
const MAX_RULE_LENGTH = 100;

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
// /__sitedrift/x.
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
