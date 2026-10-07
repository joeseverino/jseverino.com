import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sitemapLastmods } from '../../src/lib/sitemap.ts';

const origin = 'https://example.test';
const writeups = [
  { url: `${origin}/portfolio/a/`, technologies: ['astro', 'cloudflare'], date: new Date('2026-03-01') },
  { url: `${origin}/portfolio/b/`, technologies: ['astro'], date: '2026-09-15' },
  { url: `${origin}/portfolio/undated/`, technologies: ['linux'], date: undefined },
];

describe('sitemapLastmods', () => {
  const lastmods = sitemapLastmods(writeups, origin);

  test('a writeup carries its own date', () => {
    assert.equal(lastmods.get(`${origin}/portfolio/a/`), '2026-03-01T00:00:00.000Z');
    assert.equal(lastmods.get(`${origin}/portfolio/b/`), '2026-09-15T00:00:00.000Z');
  });

  test('home, the portfolio index, and a tag page take the newest writeup they list', () => {
    assert.equal(lastmods.get(`${origin}/`), '2026-09-15T00:00:00.000Z');
    assert.equal(lastmods.get(`${origin}/portfolio/`), '2026-09-15T00:00:00.000Z');
    assert.equal(lastmods.get(`${origin}/tag/astro/`), '2026-09-15T00:00:00.000Z');
    assert.equal(lastmods.get(`${origin}/tag/cloudflare/`), '2026-03-01T00:00:00.000Z');
  });

  test('anything without a date gets none', () => {
    assert.equal(lastmods.get(`${origin}/portfolio/undated/`), undefined);
    assert.equal(lastmods.get(`${origin}/tag/linux/`), undefined);
    assert.equal(lastmods.get(`${origin}/about/`), undefined);
    assert.equal(lastmods.size, 6);
  });

  test('an unparseable date counts as none', () => {
    assert.equal(sitemapLastmods([{ url: `${origin}/portfolio/x/`, technologies: [], date: 'not a date' }], origin).size, 0);
  });
});
