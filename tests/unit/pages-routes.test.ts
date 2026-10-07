import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  functionPaths,
  htmlUrls,
  invokesFunctions,
  matchesRule,
  parseHeaders,
  readRoutes,
  shapeFindings,
} from '../../bin/lib/pages-routes.ts';
import { siteRoot } from '../../src/lib/site-root.ts';

const routes = readRoutes(path.join(siteRoot, 'public/_routes.json'));

describe('rule matching', () => {
  test('a trailing wildcard spans segments but needs the prefix', () => {
    assert.ok(matchesRule('/api/*', '/api/contact'));
    assert.ok(!matchesRule('/api/*', '/api'));
    assert.ok(!matchesRule('/api/*', '/apix/a'));
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

  test('sends only the Function routes to Functions', () => {
    for (const pathname of ['/api/contact', '/api/csp-report', '/__sitedrift/live/']) {
      assert.ok(invokesFunctions(routes, pathname), pathname);
    }
  });

  test('serves every page and static file without Functions', () => {
    for (const pathname of ['/', '/about/', '/portfolio/x/', '/404.html', '/_astro/a.js', '/assets/icons/favicon.svg', '/favicon.ico', '/robots.txt', '/sitemap-index.xml', '/.well-known/security.txt']) {
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

describe('_headers parsing', () => {
  test('a rule repeated in _headers merges its lines', () => {
    const headers = parseHeaders('# c\n/a/*\n  X: 1\n\n/b\n  Y: 2\n/a/*\n  ! Z\n');
    assert.deepEqual(headers.get('/a/*'), ['X: 1', '! Z']);
    assert.deepEqual(headers.get('/b'), ['Y: 2']);
  });
});
