#!/usr/bin/env node
// public/_routes.json keeps static assets out of Pages Functions, so they never
// spend the daily Functions quota. The CSP lives in the middleware, so an
// exclude that covers an HTML page ships that page without its policy. Fails
// when the file breaks the Pages limits, when an exclude covers a built HTML
// page or a Function route, when a miss under an exclude could get the
// nonce-dependent /404.html statically, or when an excluded path lacks its
// static fallback page or the static CSP in _headers.

import fs from 'node:fs';
import path from 'node:path';
import { abort, builtPages, finish, siteRoot } from './lib.ts';
import {
  excludeFindings, fallbackFiles, fallbackFindings, functionPaths, htmlUrls, invokesFunctions, parseHeaders, readRoutes, shapeFindings,
} from '../../bin/lib/pages-routes.ts';
import { STATIC_CSP } from '../../src/lib/edge-expectations.ts';

const { distDir, pages } = builtPages('check-routes');
const routesFile = path.join(distDir, '_routes.json');
if (!fs.existsSync(routesFile)) abort('check-routes', 'the build has no _routes.json; every asset request would run Functions.');
const routes = readRoutes(routesFile);

const problems = [...shapeFindings(routes), ...excludeFindings(routes, distDir)];
for (const { rel } of pages) {
  for (const url of htmlUrls(rel)) {
    if (!invokesFunctions(routes, url)) problems.push(`${url} is HTML but skips Functions, so it ships without a CSP`);
  }
}
const fnPaths = functionPaths(path.join(siteRoot, 'functions'));
for (const url of fnPaths) {
  if (!invokesFunctions(routes, url)) problems.push(`${url} is a Function route that _routes.json excludes`);
}

const fallbacks = fallbackFiles(routes);
for (const file of fallbacks) {
  const full = path.join(distDir, file);
  if (!fs.existsSync(full)) {
    problems.push(`/${file} is missing, so a miss under /${path.dirname(file)}/ gets the nonce-dependent /404.html statically`);
    continue;
  }
  for (const finding of fallbackFindings(fs.readFileSync(full, 'utf8'))) problems.push(`/${file} ${finding}, which the static CSP blocks`);
}

const headersFile = path.join(distDir, '_headers');
const headersText = fs.existsSync(headersFile) ? fs.readFileSync(headersFile, 'utf8') : '';
const headers = parseHeaders(headersText);
const listed = headersText.split('\n').filter((line) => /^[^\s#]/.test(line));
for (const rule of new Set(listed.filter((line, i) => listed.indexOf(line) !== i))) {
  problems.push(`_headers lists ${rule} more than once; Pages keeps only the last block`);
}
for (const rule of routes.exclude ?? []) {
  if (!(headers.get(rule) ?? []).includes(`Content-Security-Policy: ${STATIC_CSP}`)) {
    problems.push(`_headers sets no static Content-Security-Policy on ${rule}, so responses under it carry no policy`);
  }
}

finish(problems, `${pages.length} pages and ${fnPaths.length} Function routes invoke Functions; ${routes.exclude.length} static excludes carry the static CSP; ${fallbacks.length} fallback pages`, {
  heading: 'check-routes: public/_routes.json is wrong for this build:',
});
