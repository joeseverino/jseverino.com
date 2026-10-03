// Unit tests for the _routes.json matcher (bin/lib/pages-routes.ts) that
// tests/audits/check-routes.ts uses to prove no HTML page or Function route
// skips the middleware, and for the committed public/_routes.json itself.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  STATIC_FALLBACK_HTML,
  excludeFindings,
  fallbackFiles,
  fallbackFindings,
  functionPaths,
  htmlUrls,
  invokesFunctions,
  matchesRule,
  parseHeaders,
  readRoutes,
  shapeFindings,
  writeStaticFallbacks,
} from '../../bin/lib/pages-routes.ts';
import { STATIC_CSP, placeholderFindings } from '../../src/lib/edge-expectations.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { tempDir, write } from './helpers/fs.ts';

const routes = readRoutes(path.join(siteRoot, 'public/_routes.json'));

describe('rule matching', () => {
  test('a trailing wildcard spans segments but needs the prefix', () => {
    assert.ok(matchesRule('/assets/*', '/assets/icons/favicon.svg'));
    assert.ok(!matchesRule('/assets/*', '/assets'));
    assert.ok(!matchesRule('/assets/*', '/assetsx/a'));
  });

  test('a mid-rule wildcard and exact rules', () => {
    assert.ok(matchesRule('/sitemap-*', '/sitemap-index.xml'));
    assert.ok(matchesRule('/favicon.ico', '/favicon.ico'));
    assert.ok(!matchesRule('/favicon.ico', '/favicon.ico/x'));
  });

  test('an exclude beats an include', () => {
    assert.equal(invokesFunctions({ version: 1, include: ['/*'], exclude: ['/a/*'] }, '/a/b'), false);
    assert.equal(invokesFunctions({ version: 1, include: ['/*'], exclude: ['/a/*'] }, '/b'), true);
  });
});

describe('the committed _routes.json', () => {
  test('fits the Pages limits', () => {
    assert.deepEqual(shapeFindings(routes), []);
  });

  test('keeps pages, the API, and the preview proxy on Functions', () => {
    for (const pathname of ['/', '/about/', '/portfolio/x/', '/404.html', '/api/contact', '/api/csp-report', '/__sitedrift/live/']) {
      assert.ok(invokesFunctions(routes, pathname), pathname);
    }
  });

  test('serves static files without Functions', () => {
    for (const pathname of ['/_astro/a.js', '/assets/icons/favicon.svg', '/favicon.ico', '/robots.txt', '/sitemap-index.xml', '/.well-known/security.txt']) {
      assert.ok(!invokesFunctions(routes, pathname), pathname);
    }
  });

  test('every Function file maps to a routed path', () => {
    const paths = functionPaths(path.join(siteRoot, 'functions'));
    assert.deepEqual(paths.toSorted(), ['/__sitedrift/x', '/api/contact', '/api/csp-report']);
    for (const pathname of paths) assert.ok(invokesFunctions(routes, pathname), pathname);
  });
});

describe('shape and URL mapping', () => {
  test('flags an empty include and overlong rules', () => {
    const findings = shapeFindings({ version: 1, include: [], exclude: [`/${'a'.repeat(100)}`] });
    assert.equal(findings.length, 2);
  });

  test('maps built files to the URLs Pages serves', () => {
    assert.deepEqual(htmlUrls('index.html'), ['/', '/index.html']);
    assert.deepEqual(htmlUrls(path.join('about', 'index.html')), ['/about/', '/about/index.html']);
    assert.deepEqual(htmlUrls('404.html'), ['/404', '/404.html']);
  });
});

describe('misses under the excludes', () => {
  test('every committed exclude carries the static CSP in public/_headers', () => {
    const headers = parseHeaders(fs.readFileSync(path.join(siteRoot, 'public/_headers'), 'utf8'));
    for (const rule of routes.exclude) {
      assert.ok((headers.get(rule) ?? []).includes(`Content-Security-Policy: ${STATIC_CSP}`), rule);
    }
  });

  test('a rule repeated in _headers merges its lines', () => {
    const headers = parseHeaders('# c\n/a/*\n  X: 1\n\n/b\n  Y: 2\n/a/*\n  ! Z\n');
    assert.deepEqual(headers.get('/a/*'), ['X: 1', '! Z']);
    assert.deepEqual(headers.get('/b'), ['Y: 2']);
  });

  test('prefix excludes get a fallback page; partial wildcards and absent files are findings', () => {
    const dist = tempDir('pages-routes-');
    write(path.join(dist, 'robots.txt'), 'x');
    const candidate = { version: 1, include: ['/*'], exclude: ['/assets/*', '/robots.txt', '/sitemap-*', '/feed.xml'] };
    assert.deepEqual(fallbackFiles(candidate), ['assets/404.html']);
    const findings = excludeFindings(candidate, dist);
    assert.equal(findings.length, 2);
    assert.match(findings[0] ?? '', /\/sitemap-\* is a partial wildcard/);
    assert.match(findings[1] ?? '', /\/feed\.xml names a file the build does not emit/);
    fs.rmSync(dist, { recursive: true, force: true });
  });

  test('the committed excludes are all prefixes or exact files', () => {
    assert.deepEqual(routes.exclude.filter((rule) => rule.includes('*') && !/^\/[^*]+\/\*$/.test(rule)), []);
  });

  test('the fallback page renders under the static CSP and is written for each prefix', () => {
    assert.deepEqual(fallbackFindings(STATIC_FALLBACK_HTML), []);
    assert.deepEqual(placeholderFindings(STATIC_FALLBACK_HTML), []);
    assert.equal(fallbackFindings('<style nonce="__CSP_NONCE__">p{}</style><script>1</script>').length, 3);
    const dist = tempDir('pages-routes-');
    write(path.join(dist, '_routes.json'), JSON.stringify({ version: 1, include: ['/*'], exclude: ['/a/*', '/.well-known/*', '/x.txt'] }));
    assert.deepEqual(writeStaticFallbacks(dist), ['a/404.html', '.well-known/404.html']);
    assert.equal(fs.readFileSync(path.join(dist, '.well-known/404.html'), 'utf8'), STATIC_FALLBACK_HTML);
    fs.rmSync(dist, { recursive: true, force: true });
  });

  test('the placeholder check matches the attribute; page text that names it passes', () => {
    assert.deepEqual(placeholderFindings('<p>the build stamps __CSP_NONCE__ on tags</p>'), []);
    assert.equal(placeholderFindings('<script nonce="__CSP_NONCE__"></script>').length, 1);
  });
});
