#!/usr/bin/env node
// public/_routes.json sends only Function routes to Pages Functions, so every page is a static
// asset: no page view spends the Functions quota. Also checks the built _headers is complete
// (no placeholder, no duplicate path, policy rules present).

import fs from 'node:fs';
import path from 'node:path';
import { abort, builtPages, finish, siteRoot } from './lib.ts';
import { functionPaths, htmlUrls, invokesFunctions, matchesRule, parseHeaders, readRoutes, shapeFindings } from '../../bin/lib/pages-routes.ts';

const { distDir, pages } = builtPages('check-routes');
const routesFile = path.join(distDir, '_routes.json');
if (!fs.existsSync(routesFile)) abort('check-routes', 'the build has no _routes.json; every asset request would run Functions.');
const routes = readRoutes(routesFile);

const problems = shapeFindings(routes);
for (const { rel } of pages) {
  for (const url of htmlUrls(rel)) {
    if (invokesFunctions(routes, url)) problems.push(`${url} is HTML but invokes Functions; pages are static assets`);
  }
}
const fnPaths = functionPaths(path.join(siteRoot, 'functions'));
for (const url of fnPaths) {
  if (!invokesFunctions(routes, url)) problems.push(`${url} is a Function route that _routes.json does not include`);
}
for (const rule of routes.include) {
  if (!fnPaths.some((url) => matchesRule(rule, url))) problems.push(`include ${rule} matches no Function route`);
}

const headersFile = path.join(distDir, '_headers');
const headersText = fs.existsSync(headersFile) ? fs.readFileSync(headersFile, 'utf8') : '';
const headers = parseHeaders(headersText);
const listed = headersText.split('\n').filter((line) => /^[^\s#]/.test(line));
for (const rule of new Set(listed.filter((line, i) => listed.indexOf(line) !== i))) {
  problems.push(`_headers lists ${rule} more than once; Pages keeps only the last block`);
}
if (headersText.includes('__')) problems.push('the built _headers still carries a build placeholder; bin/build-csp.ts did not run');
const policy = (rule: string, prefix: string) => (headers.get(rule) ?? []).some((line) => line.startsWith(prefix));
if (!policy('/*', 'Content-Security-Policy: ')) problems.push('_headers sets no Content-Security-Policy on /*');
if (!policy('/contact/*', '! Content-Security-Policy') || !policy('/contact/*', 'Content-Security-Policy: ') || !policy('/contact/*', 'Content-Security-Policy-Report-Only: ')) {
  problems.push('_headers does not give /contact/* its own policy (detach the global one, then set an enforced and a report-only line)');
}

finish(problems, `${pages.length} pages are static; ${fnPaths.length} Function routes are the only routes that invoke Functions; _headers carries the policy`, {
  heading: 'check-routes: public/_routes.json or _headers is wrong for this build:',
});
